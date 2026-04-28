# Smoke test — performance analysis

## What the test runs

`tests/agent_extensions/plugins/noesis/smoke/run-smoke.ts` (367 lines) drives three real `claude -p` headless sessions against fresh tmp data + project dirs, then boots the dev backend and asserts the UI view endpoints. The fixtures are tiny:

| File | Lines | Purpose |
| --- | --- | --- |
| `fixtures/transcript.md` | 30 | Sales pricing review — 6 turns, one decision (PricingPolicy, non-negative price), one off-topic Decision-style turn (React 19) to exercise `Irrelevant` filtering. |
| `fixtures/design-draft.md` | 37 | Sales — Order Placement: one bounded context, one module, one aggregate, one domain service, one rule (`NonNegativePrice`). |
| `fixtures/extra-requirements.md` | 19 | Bulk discount addendum — adds tiered rule + `PricingAdmin` actor. |

`run-smoke.ts:39` sets a flat `SKILL_TIMEOUT_MS = 15 * 60 * 1000` (15 min) per skill. The chain is strictly serial:

1. `/noesis:analyze-conversation` — reads transcript, runs the (now bundled) Step 4 review, validates, merges.
2. `/noesis:analyze-design-draft` — reads design-draft, fragments + topics, **per-topic loop** review, design-model extraction, merge.
3. `/noesis:create-design-doc` — pulls graph context, reads extra-requirements, runs six analysis sub-steps, emits a Design Doc diff.
4. UI verification — boots dev backend with `NOESIS_DEV_NO_SEED=1`, hits `/api/ui/{topics, decisions, design-docs, schema-explorer, model-explorer}`.

## What was observed in the latest run

- `analyze-conversation` succeeded: 1 topic added, 1 decision added. Wall time ≈ a few minutes (the new `prepare_review_bundle` collapses Step 4 to a single bundle read + one Edit + one validate).
- `analyze-design-draft` hit the 15-min `SKILL_TIMEOUT_MS` and the test failed.
- Total wall before failure: ~18–20 min for two skills out of three.

## Why it is slow

### Cold start paid three times
Each phase spawns a separate `claude -p` (`run-smoke.ts:152`). Plugin load, MCP server startup, prompt-cache warm-up, model load all happen three times. There is no `--resume` or single-session multiplexing.

### Per-topic loops still dominate `analyze-design-draft`
`skills/analyze-design-draft/SKILL.md:101-115` Step 5 still uses the loop pattern (`get_topic_for_document_review` → Edit → repeat) that IMPROVEMENT-PLAN2 §1 removed from `analyze-conversation`. On a 37-line draft producing several topics, this is N round-trips of (MCP call + tmp-file Read + Edit) plus N model turns. Each turn is several Sonnet seconds; the loop dominates the 15-minute window.

### Reference files reload on every skill
- `analyze-conversation/references/{extract-topics, analyze-topic}.md` — 152 + 147 lines.
- `analyze-design-draft/references/*.md` — 140 + 112 + 55 + 111 = 418 lines, with `design-doc-schema.md` explicitly flagged "do not load unless Step 6" (`SKILL.md:139`).
- `create-design-doc/references/*.md` — 68 + 43 + 7 + 31 = 149 lines plus `design-doc-schema.md` re-loaded in Step 4.

Each reference is read inside the skill via the Read tool. They are not in the prompt cache because each `claude -p` cold-starts.

### `create-design-doc` does six analysis sub-steps
`skills/create-design-doc/SKILL.md:67-123` — §3.1 through §3.6. Each writes its own scratch Markdown to `<working_dir>` ("progressive disclosure"), and §3.6 re-reads all five files to compile. That is roughly six model turns minimum, before Step 4 produces the diff.

### Verification phase is fast — the cost is the agent-driven phases
`verifyAllViews` (`run-smoke.ts:244`) hits five plain JSON endpoints and returns in milliseconds. It does not contribute meaningfully to the wall time.

### The flat 15-min timeout hides cost variance
A successful `analyze-conversation` and a failed `analyze-design-draft` look identical from the test's perspective (`/noesis:<skill> exited with code N`). There is no per-step timing, no phase progress, no early signal that the agent is stuck. The only telemetry is whatever `claude -p` happens to print to stdout.

## Optimisations

### High-impact

1. **Apply IMPROVEMENT-PLAN2 §1 to `analyze-design-draft` Step 5.** Mirror what we just did for `analyze-conversation`: drop `get_topic_for_document_review` and add `prepare_document_review_bundle` returning every topic in post-order in one Markdown bundle. Single Read + single Edit + single validate replaces N round-trips. This is the largest single saving and removes the most likely cause of today's timeout. Server reuses `formatEnrichedDocumentTopicMarkdown` (or analogue) just like `prepareReviewBundle` reuses `formatEnrichedTopicMarkdown` in `mcp/noesis-graph/knowledge/conversations/conversations.service.ts`.

2. **Run all three skills in one `claude -p` session.** `run-smoke.ts:107-133` currently spawns three independent processes. Concatenate the three slash commands into one prompt (or use `--continue`/`--resume`) so plugin load + MCP server boot + prompt cache happen once. Caveat: needs `merge_conversation` and `merge_document` to flush before the next phase reads — already true today, since each skill ends with a merge.

3. **Stream output and gate on phase markers.** Switch `runClaudeSkill` to `--output-format stream-json --include-partial-messages` and parse for `"tool_use": {"name": "merge_conversation"}` (or per-step markers) to (a) emit progress to the smoke log every minute, (b) detect "agent is stuck mid-loop" before the 15-minute hammer falls, (c) report the exact MCP tool active at timeout. This does not speed the run but removes the silent-failure mode and shortens diagnosis.

4. **Add a dedicated `validate_output` round-trip to `analyze-design-draft` (mirror §2 of IMPROVEMENT-PLAN2).** The same pattern that eliminated the agent's shadow Python validator in `analyze-conversation` would prevent equivalent ad-hoc scripts here. Less wall time, fewer agent-side correctness loops.

### Medium-impact

5. **Per-skill timeouts based on observed P95.** Replace the flat 15-min ceiling with `{ analyze_conversation: 6 * 60_000, analyze_design_draft: 12 * 60_000, create_design_doc: 10 * 60_000 }`. A tight `analyze-conversation` budget will fail loudly the moment the new bundle path regresses.

6. **Pre-load reference files into the system prompt.** Reference files like `analyze-topic.md`, `analyze-document-topic.md`, `bdd_examples.md` are stable and short. Inlining them (or hashing them into a cached system-prompt block) trades prompt-token cost for a removed Read tool round-trip per skill run. Worth measuring.

7. **Skip Step 6 when the draft already names a Design Doc target.** `analyze-design-draft/SKILL.md:54-56` already short-circuits "exists + target provided"; verify the smoke fixtures hit the fast path. If not, adjust `runAnalyzeDesignDraft` (`run-smoke.ts:115`) to provide `design_doc_id` once known.

### Low-impact / hygiene

8. **Park the dev backend even on failure.** Today (`run-smoke.ts:71-75`) the test exits before reaching the backend if any skill fails. For local debugging, keeping the backend up after a failed skill run lets the human inspect partial state — gate this on `NOESIS_SMOKE_KEEP_BACKEND_ON_FAIL=1`.

9. **Print elapsed time per phase.** Two extra `console.log`s in `runClaudeSkill` would surface the phase that owns most of the wall time without depending on stream-json parsing.

10. **Drop the 60-second backend-boot timeout if all skills finished correctly.** Currently `BACKEND_BOOT_TIMEOUT_MS` is 60 s (`run-smoke.ts:40`); on a healthy run boot is ~3 s. Not a perf issue but could log a warning if boot exceeds 10 s — useful regression signal.

## Suggested sequencing

| Order | Change | Risk | Expected saving |
| --- | --- | --- | --- |
| 1 | `analyze-design-draft`: bundle Step 5 (#1) | medium | likely brings the skill from >15 min to ~5 min on this fixture |
| 2 | `analyze-design-draft`: `validate_document_output` (#4) | low | removes agent-side scripts, matches `analyze-conversation` |
| 3 | Single-session smoke (#2) | medium | one cold start instead of three |
| 4 | Stream-json gating (#3) | low | observability, not raw speed |
| 5 | Per-skill timeouts (#5) | low | regression visibility |

`#1` is the prerequisite for the smoke test to finish at all on this fixture; the rest are additive.

## Out of scope

- Making the smoke test cheaper in tokens. Token cost scales with the number of tool calls and reference reads — fixed by the skill design, not by `run-smoke.ts`.
- Replacing real LLM execution with recorded fixtures. That converts the test from integration to unit and loses the regression value.
- Tuning Anthropic API parameters (model, max tokens). Out of scope for the test harness; fold into the per-skill prompts if a saving is identified.
