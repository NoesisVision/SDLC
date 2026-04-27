# `analyze-design-draft` — Improvement Plan

Source: post-mortem after the first production run of `noesis:analyze-design-draft` on the Polish design draft `wycena-dokumentów` (`design-doc.json` persisted under `~/Noesis/SDLC Sente/conversations/wycena-dokumentów/`). Date of run: 2026-04-25.

The pipeline produced sensible top-level outputs (252 fragments classified, 23 topics, 9 decisions, 3 attachments, 49 building blocks across 7 actors / 1 BC / 7 quality attributes), but the **design doc cannot be read back** — `read_design_doc` rejects every `DesignedBehaviour` row with `Invalid input: expected array, received null`. Because the skill is meant to iterate against a previously persisted design (Step 6 with `<design_doc_id>`), this regression bricks subsequent runs.

This document groups every reported issue with: **what the agent saw**, **root cause in code** (file:line where useful), and **agreed fix**. Backward compatibility is not a concern — the graph DB will be cleared.

---

## 1. 🔴 `read_design_doc` fails with `expected: array, received: null` for behaviour string-array fields

### Observed
After the first `save_design_doc` succeeded, calling `read_design_doc <id>` returned a Zod failure:

```json
[
  { "expected": "array", "code": "invalid_type",
    "path": [0, "input"],
    "message": "Invalid input: expected array, received null" },
  …
]
```

The path `[0, "input"]` points at index 0 of the `BehaviourRow` array returned by `fetchBehaviours`. Future iterations against `<design_doc_id>` cannot proceed, because Step 6 starts with `read_design_doc` to compute the diff.

### Root cause
Three independent gaps stack so that any one of them would have masked the others.

1. **Storage layer drops empty `STRING[]` to `null`.**
   `design-docs.repository.ts:34` declares `DesignedBehaviour(... input STRING[], output STRING[], used_building_blocks STRING[], ...)`. The save path always passes `[]` via `applyStringChangeSet` (`design-docs.repository.ts:1308`), but lbug/Kuzu reads the empty array back as `null`.

2. **Read-side schema is too strict.**
   `BehaviourRowSchema` (`design-docs.repository.ts:101–112`) declares `input: z.array(z.string())` with no `nullable()` and no transform. A single `null` from the DB blows up the whole row parse — and because `z.array(BehaviourRowSchema).parse(rawRows)` is wrapped around it, the entire `fetchBehaviours` call fails.

3. **Agent-side schema permits `null` ChangeSets.**
   `shared-contracts/design-doc.ts:110–120`:
   ```ts
   input: StringChangeSetSchema.nullable().default(null),
   output: StringChangeSetSchema.nullable().default(null),
   usedBuildingBlocks: StringChangeSetSchema.nullable().default(null),
   rules: DesignedRuleChangeSetSchema.nullable().default(null),
   scenarios: DesignedScenarioChangeSetSchema.nullable().default(null),
   ```
   `null` is overloaded as "no changes", but `applyStringChangeSet(null)` returns `[]`, which silently *clears* the persisted list. The semantics are inconsistent.

### Agreed fix

**Principle:** `null` / `undefined` mean "value is absent". If absence is allowed, the logic must explicitly handle it; if absence is not allowed, raise an error immediately. `null` must never be used as a sentinel to clear an array.

**Agent-side (input) schema — strict validation.** Drop `.nullable()` from every ChangeSet field. ChangeSets become **optional** instead:

```ts
input: StringChangeSetSchema.optional()
  .describe("Input BuildingBlock names; omit when no changes"),
output: StringChangeSetSchema.optional()
  .describe("Output BuildingBlock names; omit when no changes"),
usedBuildingBlocks: StringChangeSetSchema.optional()
  .describe("Referenced BuildingBlock names; omit when no changes"),
rules: DesignedRuleChangeSetSchema.optional(),
scenarios: DesignedScenarioChangeSetSchema.optional(),
```

Rules:
- Missing / `undefined` ChangeSet → "no changes were made", do not touch the persisted list.
- Present ChangeSet → must have `added: string[]`, `modified: ChangeSpec[]`, `removed: string[]`. Never `null`. Empty arrays are fine.
- To clear a list, the agent emits `{ added: [], modified: [], removed: [<every current item>] }` — never `null`.
- Apply the same rule to `description`, `type`, `actor`, and any other currently-`nullable()` scalar where "absent" is the intended meaning: prefer `.optional()`. Use `.nullable()` only when `null` is a real, distinct domain value.

**Apply layer.** `applyStringChangeSet` (and its peers for rules/scenarios/properties/etc.) now receives `ChangeSet | undefined`. On `undefined` it returns the existing list unchanged. It never receives `null`.

**Storage write layer.** Always pass `[]` for "no items"; never write `null` to the DB.

**Storage read layer.** Coalesce `null` → `[]` at parse time so consumers always see arrays:

```ts
const StringArrayRow = z
  .array(z.string())
  .nullable()
  .transform((v) => v ?? []);
const BehaviourRowSchema = z.object({
  …,
  input: StringArrayRow,
  output: StringArrayRow,
  used: StringArrayRow,
});
```

Apply the same `nullable().transform(() => [])` pattern to every STRING[] / list column in the repository. Document the lbug quirk in a one-paragraph block in `design-docs.repository.ts` so the next person doesn't re-discover it.

**Skill-prompt-side.** In `references/design-doc-schema.md` Section 3, replace any current "null = no changes" wording with:

> A ChangeSet field is **optional**. Omit it when there are no changes. When you do emit it, it MUST have all three keys: `{ "added": [...], "modified": [...], "removed": [...] }`. Never emit `null` for a ChangeSet — `null` is rejected.
>
> To remove every item, list every current item under `removed` and leave `added` / `modified` empty. Do not use `null` as a clear-signal.

---

## 2. 🔴 `save_design_doc` totals counter is misleading

### Observed
`save_design_doc` reported `totals.added: 15` after the first run. The actual persisted state contained:
- 7 actors, 1 BC, 7 quality attributes (the 15)
- 1 module, 49 building blocks
- 44 behaviours
- ~150 properties
- N rules, M scenarios

A user reading "15 added" has no signal that 250+ child entities were also written. Worse: when the agent re-saved the same doc with `id` set, the totals stayed at `15` even though the recursive upsert had updated 44 behaviour rows.

### Root cause
`design-docs.service.ts:53–74` builds `totals` from only three top-level counters; the recursive upserts for modules, building blocks, behaviours, rules, scenarios, and properties never bump anything. The count is structurally wrong, but more fundamentally it is **the wrong contract**: the agent should not have to inspect counts to confirm a save.

### Agreed fix
**Drop the counters entirely.** The MCP tool guarantees the save, end-to-end. If the save succeeds, return a minimal success payload. If it fails, return an error — the agent fixes the input and retries.

```ts
// success
{ status: "Ok", design_doc_id: "..." }

// failure (validation, storage, etc.)
{ status: "Error", message: "<concise human-readable reason>" }
```

If a future use case genuinely needs a per-layer breakdown for the UI (not for the agent), it should be a separate read endpoint, not a side-channel on the save response.

**Large outputs (e.g. detailed validation error trees).** When the error payload itself can grow large — multi-page Zod issue lists, per-row breakdowns — write the detail to a tmp file and return `{ status: "Error", message: "...", details_path: "/tmp/..." }`. This matches the plugin's "scripts and MCP tools that may exceed ~10 KB write to a tmp file" rule.

**Input is already file-based.** `save_design_doc` already takes `path: <design_doc_path>`, so the inbound DesignDoc payload doesn't traverse stdio. No change there.

---

## 3. 🟡 Skill instructions for Step 6 contradict each other

### Observed
The agent had to choose between two contradictory instructions for persisting the design doc:

- `SKILL.md:126` — "Write the validated `DesignDoc` payload directly to `<design_doc_path>` … Then call MCP tool `noesis-graph:save_design_doc` with `path: <design_doc_path>`."
- `references/extract-design-model.md:47` — "`merge_document` orchestrates the actual graph persistence in Step 7. Do NOT call `save_design_doc` directly."

The reference also says to write the JSON to `<working_dir>/design_doc.json` (line 44), while SKILL.md tells the agent to write to `<design_doc_path>` (the user-provided repository location).

`merge_document` (`documents.service.ts:148–235`) does **not** persist design docs at all — it only handles topics, document fragments, decisions, and decision attachments.

### Root cause
`extract-design-model.md` was written before Step 6 was extracted from `merge_document` into a standalone `save_design_doc` tool, and the reference was not updated. The duplicated Save instructions in two files made the drift possible in the first place.

### Agreed fix
**SKILL.md is canonical.** The Save flow (write file → call `save_design_doc`) lives only in SKILL.md. `extract-design-model.md` describes _what_ the model is and _how to derive it from fragments_, not how to persist it.

Concretely:
- Delete the entire "Save" section from `references/extract-design-model.md` (the file path, the `merge_document` claim, the post-save `output.json` edits — all of it).
- Replace it with one line: _"Persistence is handled by SKILL.md Step 6. Do not duplicate Save instructions here."_
- Audit every other reference doc for similar duplicated/outdated persistence wording and prune.
- Two distinct commits: **(a)** the model is persisted by `save_design_doc`; **(b)** topics, fragments, decisions, and attachments are persisted by `merge_document`. The user can inspect or edit the persisted design before knowledge-graph artefacts attach to it.

---

## 4. 🟡 Decision attachments are noisy

### Observed
- Decision `5fd216f8` (RB-1 invariant): 19 fragments attached. Most are tangential mentions in coverage tables; the load-bearing evidence is ~3 (the RB-1 statement itself, the `SourceDocumentLineId` field declaration, the `CreatePriceState` handler).
- FIFO decision: 8 fragments. About half are tangential.

When the next analysis surfaces this decision via `list_decisions` or `get_topic_for_document_review`, the user sees a wall of weakly-supportive snippets instead of the 3–5 strongest.

### Root cause
`references/analyze-document-topic.md` (which governs Step 5 attachments) does not cap evidence count.

### Agreed fix
Add a **prompt-level rule** (no server enforcement). Edit `references/analyze-document-topic.md`:

> When attaching to an existing decision, attach **at most 5 fragments per slot per decision** — pick the most directly supportive evidence. If more than 5 fragments touch the decision, prefer ones that:
>
> 1. State the rule / option / consequence explicitly (verbatim wording wins).
> 2. Show a concrete code-side artefact (field, handler, type) that anchors the rule.
> 3. Cover a distinct perspective (don't attach the same paragraph twice).
>
> Tangential mentions in coverage tables, recap sections, or table-of-contents
> entries should not be attached.

No server-side hard cap — the rule is in the prompt, the agent is responsible for following it.

---

## 5. 🟡 Topic granularity is uneven

### Observed
- "Rejestracja delt" — 30 items. Could naturally split into _command surface_, _storno algorithm_, _propagation algorithm_.
- "Zdarzenia domenowe modułu" — 1 item. Almost certainly should fold into a parent.
- "Diagram struktury" (12 items) overlaps with the PriceState / Delta topics, and probably should not exist as a sibling.

The Goldilocks loop in Step 2 picked "just-right" granularity from the existing graph, but Step 3's _new_ topics (driven by the cleaned doc's headings) didn't get the same scrutiny — headings became topics 1:1.

### Root cause
`references/extract-document-topics.md` instructs "reuse before promote" but says nothing about the **shape of the resulting hierarchy**. There is no instruction to balance the topic tree, no preference for a single root per document, and no upper bound on first-level breadth.

### Agreed fix
Rewrite the topic-shape guidance in `references/extract-document-topics.md` with explicit hierarchy rules:

> ### Topic hierarchy
>
> Topics form a hierarchy that humans must be able to navigate. The agent's job is
> to keep that hierarchy legible.
>
> 1. **Single root per document.** In most cases a document or conversation has
>    one root topic that frames the whole subject. Multiple unrelated roots are a
>    smell — usually they should hang under a shared parent that names what binds
>    them.
> 2. **First-level breadth ≤ 10.** No more than ~10 sibling topics directly under
>    a root. If you find yourself producing more, the categorisation axis is
>    probably too narrow — group along a coarser axis and demote the current ones
>    one level down.
> 3. **Reuse the existing structure.** Before adding a new topic — and especially
>    before adding a new first-level topic — read the existing topic tree end to
>    end. New topics at the first level are added only when there is concrete
>    evidence that no existing branch fits.
> 4. **Re-shape when needed.** Merging, splitting, and re-parenting existing
>    topics is part of the job, not an exception. If a previously created topic
>    no longer fits the cleaned document's actual structure, change it. Record
>    the rationale in the iteration's commit message.
> 5. **Reason from semantic axes, not counts.** Item count is a smell, not a
>    verdict. A 1-item topic is fine if it is genuinely orthogonal; a 30-item
>    topic is fine if all 30 belong to one tightly-coupled algorithm. Always
>    decide based on the underlying semantic axes (command vs algorithm,
>    happy-path vs edge-case, data-model vs behaviour, …) — never on a numeric
>    threshold alone.

This replaces the heading-as-topic 1:1 default and makes hierarchy hygiene an explicit step instead of an afterthought.

---

## 6. 🟡 Fragment categorization underused

### Observed
- Only 18 fragments tagged `Position+Argument` (RB-style invariant rules).
- Only 4 tagged `Decision+Information` (DPs / DTs).
- Many architectural choices in the body (storno-by-flag, append-only motive, "od najwekszego" FIFO strategy) live in pure `Information` paragraphs and never surface as decisions.

### Root cause
The category definitions in `references/extract-document-topics.md` lean toward "what is asserted" rather than "what was chosen". Soft-spoken design choices in narrative form ("…ponieważ…", "…zamiast…", "…zdecydowaliśmy się na…") are easy to miss when the agent scans for explicit `Decision`-shaped paragraphs.

### Agreed fix
Tighten the category cheat-sheet with concrete narrative-style examples:

```md
## Decision (with examples that the eye easily misses)

A fragment is `Decision` content when it picks an option from alternatives, even
when phrased as narrative:

- "We use append-only deltas because…" → Decision (option chosen + rationale)
- "Instead of recomputing, we store…" → Decision (alternative ruled out)
- "FIFO over LIFO because…" → Decision

Combine with `Information` if the fragment also explains the chosen option, or
with `Argument` if it states a load-bearing reason.
```

Same treatment for `Position+Argument` (rule statements that don't look like
"INVARIANT:" but still are).

---

## 7. ⏱️ Time-efficiency optimisations

These are not correctness issues; they are wasted work the agent observed.

### 7.1 Three full-doc Reads where a tree + targeted snippet would do — **fix**
The cleaned doc is ~50 KB. The agent did three Reads to span it. `<section_tree_path>` (~1 KB) plus selective fragment reads from `output.json` would have answered the same questions. ~30 s.

Add to `SKILL.md` Step 3:

> Prefer `<section_tree_path>` for structural questions and selective fragment
> reads from `output.json` for content questions. Only read `<cleaned_path>`
> end-to-end when you need flowing narrative across sections.

### 7.2 Three sequential Python scripts where one would do — **leave for now**
`assign_topics`, `review_topics`, `build_design_doc` ran sequentially. They could be one orchestrator, but this was an agent-side improvisation, not a documented step. Revisit only if the multi-script pattern recurs.

### 7.3 Bypassed `get_topic_for_document_review` for 21 of 23 topics — **leave for now**
The agent batched the summary writes, calling the tool only twice instead of per-topic. This was an intentional, working optimisation but skipped the formal contract. Don't sanction it yet — observe more runs first.

### 7.4 Normalisation happened post-save — **fixed by §1**
The agent wrote the design doc, called `save_design_doc`, hit the Zod failure, then patched the file. Once §1 lands (strict input validation rejects `null`, missing ChangeSets are valid, DB reads coalesce `null` → `[]`), this round-trip becomes correct on the first attempt.

---

## Implementation plan (recommended sequencing)

### P0 — Unblock iteration (server + contracts, one PR)
- §1: drop `.nullable()` on ChangeSet fields in `shared-contracts/design-doc.ts`; switch to `.optional()` with "missing = no changes" semantics. Update `applyStringChangeSet` and peers to treat `undefined` as "leave list unchanged" and reject `null`.
- §1: read-side `nullable().transform(v => v ?? [])` for every STRING[] column in `design-docs.repository.ts`. Storage writes always send `[]`, never `null`.
- §1: regression test that round-trips a behaviour with omitted `input/output/usedBuildingBlocks` through `save_design_doc` → `read_design_doc`.
- §3: rewrite `extract-design-model.md` Save section to defer to SKILL.md Step 6 (pure docs).

### P1 — Simpler save contract (server, one PR)
- §2: drop `totals` from `SaveDesignDocResult`. Return `{ status: "Ok", design_doc_id }` on success, `{ status: "Error", message, details_path? }` on failure. Update SKILL.md Step 6 to match.

### P2 — Quality of analysis (skill prompts, one PR, no code)
- §4: add 5-fragment-per-decision cap to `analyze-document-topic.md`.
- §5: add the topic-hierarchy rules (single root, ≤10 first-level, reuse, re-shape, semantic-axis reasoning) to `extract-document-topics.md`.
- §6: tighten Decision / Position cheat-sheet with narrative-style examples.

### P3 — Efficiency nudges (skill prompts, one PR, no code)
- §7.1: prefer section tree + selective reads in SKILL.md Step 3.

### Out of scope (for now)
- §7.2 (single post-process script) — premature.
- §7.3 (sanctioned batch path) — observe more runs first.
- Backward compatibility with previously persisted design docs — DB will be cleared.
