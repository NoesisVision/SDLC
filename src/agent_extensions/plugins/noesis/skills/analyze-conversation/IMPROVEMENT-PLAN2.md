# `analyze-conversation` — Improvement Plan v2

Source: post-mortem after the second production run of `noesis:analyze-conversation` (Polish sales-call transcript `2026-02-10-cz1.md`, 232 turns / 269 idea units / 15 topics / 28 decisions). The pipeline completed and the merged graph was acceptable, but the agent's behaviour diverged from the prescribed workflow in two principled ways:

1. **Step 3** — built `output.json` with a 487-LOC Python script instead of authoring it inside the Write tool.
2. **Step 4** — bypassed the per-topic loop with a 405-LOC Python script that wrote all 15 summaries+decisions in one pass, in direct violation of the skill's *"Do not parallelize. Each iteration depends on the previous edit."*

The naive reading is *"the agent is undisciplined."* The correct reading is that **the workflow protocol pushes the agent into ad-hoc tooling whenever the cost of staying inside the prescribed flow exceeds the cost of working around it.** The same dataset would push any future agent in the same direction. This plan is therefore not about fixing one run — it is about removing the structural reasons the agent reached for those workarounds.

The smaller observations from the run (oversized `KAT` topic, debatable `T148:IU0` placement, faktura-marketingowa straddle) are *not* turned into rules. They are signals of subjective judgement calls that any agent will make differently — guidance, not enforcement.

---

## 1. 🔴 Step 4: per-topic loop is over-prescription, not protocol

### Observed
The skill says, in `SKILL.md` Step 4 and `references/analyze-topic.md`:

> Loop: call `get_topic_for_review` → read → edit `output.json` → repeat. Do not parallelize. Each iteration depends on the previous edit.

The agent ran one MCP call (`get_topic_for_review` once on an empty graph), then wrote a Python script that filled `short_summary`, `long_summary`, `decisions`, `reviewed: true`, and `decisions_extracted: true` for every topic in one pass. The merged graph is consistent. The "violation" produced a correct result.

### Root cause
The loop was added in IMPROVEMENT-PLAN.md §2 to support three things:

1. **Prior-conversation enrichment.** `get_topic_for_review` merges `[prior conversation]` idea units before the agent summarises (`conversations.service.ts:84`).
2. **Post-order container synthesis.** `postOrderTopicIds` (`conversations.service.ts:300`) yields children before their parents so `## Subtopics` carries finalized child summaries when the parent is reviewed (`conversations.service.ts:117`).
3. **Per-topic coherence check / reassignment** (`analyze-topic.md:42`).

On the second run the graph was empty, so (1) was a no-op. The agent had planned the entire topic tree holistically in Step 3, so (2) was internally satisfied without per-topic iteration. (3) had been settled during Step 3 planning. The loop carried zero new information per iteration — it was a sequence of mechanical Edits.

The agent took the mechanically equivalent shortcut. From its perspective, Python gave **cross-topic correctness verification** (every IU assigned exactly once, every Decision's `referenced_items` correctly indexed) that the loop did not. The loop was not just slow; it was less safe.

This is a design smell. A workflow that the agent treats as theatre on the most common input (empty or sparsely-populated graph) is a workflow that will keep being bypassed.

### Refined design

**Replace the per-topic loop with a single bundled review.** The post-order traversal, prior-conversation enrichment, and `## Subtopics` rendering already live in `ConversationsService`. Instead of dripping topics out one at a time, return them all at once, in post-order, in a single Markdown bundle.

#### MCP contract change

Drop `get_topic_for_review`. Add `prepare_review_bundle`:

- **Input**: `{ output_path: string }`.
- **Output**: file path. The file is a Markdown bundle: `# Topics for review` header, then each topic's enriched section in post-order separated by `---`. Each section is the same Markdown that `formatEnrichedTopicMarkdown` produces today (with `## Subtopics` always rendering child titles + finalized child summaries when present, and `[prior conversation]` markers on prior idea units). Each section is preceded by HTML-comment metadata: `<!-- topic_id: ... -->`, `<!-- num_items: ... -->`, `<!-- has_decision_units: ... -->`. A trailing JSON line carries the `review_token` (see Validation below).
- **Inline JSON**: small confirmation `{ status: "Ok", file: "...", topic_count: N, topics_with_prior_units: K }`. The `topics_with_prior_units` value is informational so the agent can reason about graph maturity at a glance; it does not change behaviour.

The bundle is built bottom-up. By the time the agent reads any parent's section the children's `short_summary` is already final *because the agent reads top-to-bottom, but the agent fills in summaries also in post-order.* To make this work the agent's contract is:

> Process the bundle's topic sections in the order they appear (leaves first, parents last). Write each topic's `short_summary` and `long_summary` and (if applicable) `decisions` immediately, then look at the next section. Container summaries reference what has already been written for children — exactly as in the loop.

A senior agent following this naturally produces post-order summaries because the bundle is in post-order. We are not losing the post-order property; we are encoding it in the file layout instead of in the per-call state.

#### Why this is correct on a populated graph too

The two non-loop concerns the original plan worried about:

- **Reassignment mid-review.** If the agent decides during topic N's section that one of N's items belongs to topic M (which appeared earlier or later in the bundle), it edits `output.json:conversation.topics[]` accordingly and re-validates. Reassignment is rare and the agent has the whole tree in front of it; there is no "fetch fresh state" step to lose.
- **Stale child summaries when a child is reassigned.** If the agent reassigns IUs into a topic whose section it has already filled, it must recompute that topic's summary. The validator (§2) will catch a child whose `reviewed: true` was set before its final item set was known, by re-checking that the topic's items match the schema and that no IU is double-assigned. We do not need a per-iteration round-trip for that.

#### Why not "two modes" (loop *and* bundle)

Backwards-compat is not a concern (per CLAUDE.md). Offering both modes invites the same shortcut behaviour we are trying to remove — the agent will pick whichever mode looks cheaper for the current input and the protocol fragments. Single mode, single contract.

#### Server-side changes

- Remove `get_topic_for_review` from `conversations.mcp.ts` and from the public service surface.
- Add `prepareReviewBundle(outputPath: string)` to `ConversationsService` that:
  - Reads `output.json`, computes `postOrderTopicIds` (already present at `conversations.service.ts:300`).
  - For each topic in that order, builds the same `EnrichedTopic` it builds today, joining current-conversation idea units with `getPriorIdeaUnits` (already present at `conversations.service.ts:84`) and the `## Subtopics` block via `collectSubtopics` (already present at `conversations.service.ts:117`).
  - Concatenates the per-topic Markdown sections with `\n---\n` separators and a top-level header.
  - Returns the file path through `runFileOutputTool` (the bundle is potentially large — see CLAUDE.md "Agents read data via the Read tool"). Bundle inline JSON is the small status payload above.
- Keep `postOrderTopicIds`, `collectSubtopics`, `formatEnrichedTopicMarkdown`, `EnrichedTopic` — they are reusable.
- Tests:
  - Bundle of a 3-level tree is in post-order.
  - Each parent section's `## Subtopics` lists all its direct children.
  - Empty graph: no `[prior conversation]` markers anywhere.
  - Populated graph: prior-conversation IUs appear under the correct topic and only there.
  - `topic_count` and `topics_with_prior_units` match the bundle.

#### Skill changes

- `SKILL.md` Step 4 collapses to: call `prepare_review_bundle`, read the bundle, write all summaries+decisions and `reviewed: true` / `decisions_extracted: true` for every topic in one Edit/Write of `output.json`, then call `validate_output` (§2), then `merge_conversation`.
- `analyze-topic.md` rewrites the "Loop" framing as "Reviewing the bundle". The post-order responsibility moves from the server-controlled iteration to a clearly stated reading-order rule. The Reassignment, Summaries, and Decision-extraction rules are unchanged in substance.

---

## 2. 🔴 Step 3 has no validation contract — agents bring their own

### Observed
Step 3 produces a single Write of `<working_dir>/output.json` with hundreds of idea units across hundreds of turns and dozens of topics. On the second run the agent reached for a 487-LOC Python script not for speed but for **correctness verification**:

> Total turns: 232 / Total IUs: 269 / Total non-Irrelevant IUs: 203 / Total assigned: 203 / Missing assignment for non-Irrelevant: [] / Irrelevant but assigned: []

That is precisely the validation the schema does not enforce today. `AnalyzeConversationOutputSchema` checks types and shapes (`output.ts:5-8`); it does not check the cross-cutting invariants that determine whether the merged graph will be coherent.

### Root cause
The skill ships *one* schema (`AnalyzeConversationOutputSchema`) that is structural-only. The cross-cutting invariants live nowhere:

- Every non-Irrelevant idea unit is assigned to exactly one topic.
- Every topic ID under `conversation.topics` has a matching entry in `potential_topics` (and vice-versa for `is_new` topics).
- Every `IdeaUnitRef` (in `topic.items` and inside Decisions) refers to an idea unit that exists in `conversation.turns`.
- Every Decision's `referenced_items` is fully utilized (no orphan items not referenced by any slot).
- The topic forest is acyclic; `parent_id` only points at IDs in the same `output.json` or at known graph IDs.
- First-level breadth ≤ 10 (skill rule, currently advisory).

`merge_conversation` checks some of these implicitly (it will fail when a Decision references an unknown idea unit), but failures surface mid-write — by which point partial graph state already exists. That is too late.

### Refined design

**Add an explicit `validate_output` contract between Step 3/4 and `merge_conversation`.** The agent calls it; the server checks every cross-cutting invariant; the agent fixes and re-validates until it passes. `merge_conversation` calls the same validator internally as a pre-flight gate.

#### MCP contract change

Add `validate_output`:

- **Input**: `{ working_dir: string }`.
- **Output**: inline JSON. On success: `{ status: "Ok" }`. On failure: `{ status: "Errors", errors: [{ path: string[], message: string }, ...] }`. Errors carry JSON-pointer-style paths so the agent can locate each issue without re-reading the whole file.

#### Validation rules

In a new `analyze-conversation/validate-output.ts` (under `mcp/noesis-graph/knowledge/conversations/` or a sibling skills helper), implement:

1. **Schema parse** (existing `AnalyzeConversationOutputSchema.parse`). Errors mapped 1:1.
2. **Idea-unit assignment coverage.** Build the set of all non-Irrelevant `(turn_index, idea_unit_index)` pairs. Build the set of all `IdeaUnitRef`s in `conversation.topics[*].items`. Report:
   - non-Irrelevant IUs with zero assignments,
   - non-Irrelevant IUs with multiple assignments (error),
   - Irrelevant IUs that are assigned (error).
3. **Topic-ID consistency.** Every `is_new: true` entry in `potential_topics.topics` must have a corresponding entry in `conversation.topics` with the same id; every entry in `conversation.topics` whose id is not present in the existing graph (checked via `topics.exists`) must appear in `potential_topics` with `is_new: true`.
4. **Reference integrity.** Every `IdeaUnitRef` (in topic `items`, decision `referenced_items`, anywhere) refers to an existing idea unit in the same `conversation.turns`. References to other conversations (prior conversations) are not allowed in `topic.items` or `decision.referenced_items` written by this run — those edges are managed by the server.
5. **Decision shape.** Every `referenced_items[i]` must be referenced by at least one slot's `supporting_item_indices` (orphan check). Every slot's index must be in range (already checked by the schema's `superRefine`, but reasserted here).
6. **Topic forest integrity.** `parent_id` either is `null`, points at another topic in this `output.json`, or refers to an existing graph topic. No cycles.
7. **Hierarchy hygiene (advisory).** First-level breadth (number of topics with `parent_id: null` and no graph parent) > 10 returns a *warning*, not an error. Warnings appear in the response under a separate `warnings` field; they do not block `merge_conversation`. This preserves the existing skill rule "item count is a smell, not a verdict" — the agent decides.

#### Skill changes

- `SKILL.md` Step 3: after the Write of `output.json`, call `validate_output(working_dir)`. On `Errors`, fix and re-validate. Do not proceed to Step 4 until `Ok`.
- `SKILL.md` Step 4: same gate before `merge_conversation`.
- `merge_conversation` runs `validate_output` internally and rejects with the same error shape if the gate is violated. This is the safety net for agents who skip the explicit call.

#### Why this kills the Python-script motivation

Everything the agent's Python validator computed is now a server tool call. The agent has no reason to author shadow validators. The same is true for any future agent: the contract is in the protocol, not in the agent's discretion.

#### Tests

- Unit tests for each rule with positive + negative cases.
- Integration test: take a realistic `output.json`, mutate one IU assignment, expect the right error path.
- `merge_conversation` integration test: pre-flight rejection on an invalid output.

---

## 3. 🟡 Container topic semantics: items + children is under-specified

### Observed
On the second run, container topics `SRC` and `ROOT` were treated as having both subtopics and (in `SRC`'s case) one direct idea unit (`T148:IU0`). The agent flagged this as *"debatable"* and the merged graph accepts it. The skill says (`extract-topics.md:75`):

> Container topics — parents whose own `items` list is empty because all idea units sit on subtopics — are legitimate.

…and `analyze-topic.md:53`:

> **Topic with both.** Start from the topic's own idea units, then weave in the children's contributions where they extend or qualify the picture.

The first sentence implies "container ⇒ no items"; the second explicitly allows "topic with both". These are not contradictory but they are not aligned, and on the borderline case (a single IU on what is otherwise a container) the agent has no rule to lean on.

### Root cause
The taxonomy is implicitly *(leaf, container, hybrid)* but only *(leaf, container)* is named. The hybrid case is described under summarisation, not under topic shape, and it is the one most likely to drift.

### Refined design

This is a documentation fix, not a code change. It makes the implicit taxonomy explicit and makes the test for "container vs hybrid" a single sentence the agent can apply.

In `extract-topics.md` (Topic hierarchy section), replace the trailing "Container topics" paragraph with:

> Three topic shapes are valid:
>
> - **Leaf** — has idea units, no subtopics. Most topics are leaves.
> - **Container** — has subtopics, no own idea units. Acts as a chapter in the design narrative; its summary is synthesised from its children.
> - **Hybrid** — has both subtopics and own idea units. Use only when a parent topic genuinely owns content that none of its children own — e.g. an introduction or a cross-cutting rule that does not belong to any single child. If you find yourself placing a single IU on a container "because it does not fit any child", create or extend a child topic for it instead.
>
> The default for a parent is **container, not hybrid**. Hybrid is the rare case.

In `analyze-topic.md` Summaries section, replace the three-bullet rule with:

> - **Leaf** — summaries come from the topic's idea units (current + prior).
> - **Container** — summaries are synthesised from the children's finalized summaries (in the bundle's `## Subtopics` block).
> - **Hybrid** — summarise the topic's own idea units first, then weave in what each child contributes. If the result feels like two unrelated paragraphs glued together, the topic is probably mis-shaped — promote the IU into a child topic and re-summarise as a container.

No server change is needed; the post-order traversal and `## Subtopics` rendering already cover all three cases.

---

## 4. 🟡 Topic split heuristic: nudge, don't enforce

### Observed
The `KAT` topic accumulated 47 idea units. The agent's analysis itself notes the topic fuses two sub-themes (predefined catalogue vs. forecast-and-storno). The skill says "item count is a smell, not a verdict" (`extract-topics.md:73`) — and indeed, on a tightly-coupled algorithm 47 items can be coherent. But "smell" is currently invisible: the agent has no signal that triggers re-examination.

### Root cause
The "smell" rule lives in prose only. There is no point in the workflow where the agent is prompted to step back and check whether a high-item-count topic is actually one concept.

### Refined design

Add a **soft check**, in the validator from §2, with `warnings` (non-blocking) only:

- If any topic has more than 25 own idea units (`topic.items` length, counting only non-Irrelevant IdeaUnitRefs), emit a warning: `"Topic <id> ('<title>') has N own items. Verify it covers a single concept; consider splitting if items cluster around multiple distinct sub-themes."`.

The threshold (25) is a heuristic that scales with realistic conversations — small enough to fire on borderline cases like `KAT`, large enough to not fire on legitimately-tightly-coupled topics. It is a warning, not an error: the agent reads it as *"re-examine"*, and `merge_conversation` proceeds whether or not the agent acts.

In `extract-topics.md` Topic hierarchy section, add to rule 5:

> If a topic accumulates more than ~25 own idea units, pause and ask whether the items are about the same concept or about a cluster of related concepts. The validator will emit a warning at this threshold; the warning is informational, not blocking.

---

## 5. 🟡 Decision schema: orphan referenced_items

### Observed
`DecisionSchema.superRefine` (`shared-contracts/topics.ts:38-69`) checks that every `supporting_item_indices` entry is *in range* of `referenced_items`. It does not check the inverse: that every entry in `referenced_items` is *used* by at least one slot. The second-run analysis explicitly notes this gap:

> I did not run this check; manual review of decisions would catch any mismatch but a programmatic check is safer.

An orphan in `referenced_items` is harmless to `merge_conversation` (the orphan IU stays in the topic's items list), but it bloats the JSON, signals a cleanup the agent forgot, and risks inconsistent semantics if a future reader assumes "every referenced_items entry is cited somewhere".

### Refined design

Extend `DecisionSchema.superRefine` with the inverse check:

```ts
const used = new Set<number>();
for (const idx of decision.context.supporting_item_indices) used.add(idx);
for (const idx of decision.decision.supporting_item_indices) used.add(idx);
for (const alt of decision.alternative_options) {
  for (const idx of alt.supporting_item_indices) used.add(idx);
}
for (let i = 0; i < decision.referenced_items.length; i++) {
  if (!used.has(i)) {
    ctx.addIssue({
      code: "custom",
      path: ["referenced_items", i],
      message:
        `referenced_items[${i}] is not cited by any slot; ` +
        `remove it or reference it from context / decision / an alternative_option.`,
    });
  }
}
```

This piggybacks on the existing schema parse; no new tool, no new round trip. `validate_output` (§2) and `merge_conversation` both pick it up automatically.

The skill prompt change in `analyze-topic.md` (§9.3 of the original plan) already says *"do not include items that no slot references"*. This makes the rule mechanical.

---

## 6. 🟡 Long transcripts need explicit guidance

### Observed
The cleaned transcript was 38473 tokens — well over the Read tool's 25000-token limit. The agent split it into 0–500, 500–1000, 1000–end. The Read tool's `offset` / `limit` are line-based; the agent's chunking was correct. There is currently no skill text that tells a future agent how to handle this.

### Root cause
`SKILL.md` Step 1 says "windowing is up to you" with no concrete pattern, and `extract-topics.md` is silent on long-transcript ergonomics. On the next very-long transcript the agent will rediscover the technique by trial and error.

### Refined design

Add to `extract-topics.md`, before "Idea units", a short section:

> ### Reading long transcripts
>
> The cleaned transcript may exceed the Read tool's window. Use `offset` / `limit` to scan it in line ranges. A two-pass approach works well:
>
> 1. **Structure pass.** Read the start, a middle window, and the end. This is enough to identify the topic tree and the breadth of subjects covered.
> 2. **Commit pass.** Walk the transcript end-to-end (overlapping windows are fine) committing idea units and topic assignments as you go.
>
> Reuse Grep when you only need to locate specific phrases or speaker turns inside the transcript; Read remains the right tool for any window of contiguous content the reasoning depends on.

This is purely a skill-prompt change — no code.

---

## 7. ⏭️ Process slip: `Edit` after external write — eliminated by §1+§2

### Observed
The agent's first `Edit` against `output.json` failed with *"File has been modified since read…"*, because the Python script had just rewritten it.

### Decision
This is a class of problem that disappears once the workflow stops encouraging out-of-band scripts. With §1 (no per-topic loop, single Write per step) and §2 (validation in the protocol, not in agent-side scripts), the only writers of `output.json` are the agent's Edit/Write tools and the prepare script. The harness's "file modified since read" guard then becomes a catch for genuine concurrency bugs, not a workflow speed bump.

No documentation change needed. If the pattern recurs after §1+§2 land, revisit.

---

## 8. ⏭️ The dataset-specific judgement calls — explicitly not addressed

The second-run analysis flags several borderline judgement calls:

- `T148:IU0` placement on a container vs `POD` vs split between `ZWR`/`MM`.
- `T31:IU0` (faktura marketingowa) straddling `DELTY` and `OKRES`.
- `KAT` topic fusing two sub-themes (covered as a generic warning in §4, but not enforced).

These are not bugs and not architectural smells. They are the kind of decisions a senior reviewer would also debate. Codifying them as rules would over-fit the next agent to one transcript's contour. We do not address them.

---

## 9. ⏭️ Inter-tool message length (>25-word slips) — not architectural

The post-mortem notes occasional inter-tool updates over the 25-word target. This is harness-level discipline, not a skill-design issue. No change.

---

## Implementation plan (recommended sequencing)

Backwards-compatibility is not a concern — no production data yet.

### P0 — Validation contract (one PR, code + prompt)

- §2: new `validate_output` MCP tool; `ConversationsService.validateOutput(workingDir)`; rule implementations as listed (assignment coverage, topic-id consistency, reference integrity, decision shape, forest integrity, hierarchy warning).
- §5: extend `DecisionSchema.superRefine` with the orphan check.
- §4: add the `>25 own items` warning inside the validator.
- `merge_conversation` calls `validateOutput` as a pre-flight gate.
- `SKILL.md` Step 3 / Step 4: add the explicit `validate_output` call.
- Tests as listed in §2.

Risk: low. Pure additions plus a pre-flight gate; no existing behaviour breaks.

### P1 — Bundle review (one PR, code + prompt; depends on P0)

- §1: drop `get_topic_for_review`; add `prepare_review_bundle`; reuse `postOrderTopicIds`, `collectSubtopics`, `formatEnrichedTopicMarkdown`, `getPriorIdeaUnits`.
- `SKILL.md` Step 4: rewrite as "prepare bundle → write all summaries+decisions → validate → merge".
- `references/analyze-topic.md`: rewrite the "Loop" section as "Reviewing the bundle"; rules for summaries, reassignment, decision extraction unchanged.
- Tests as listed in §1.

Risk: medium. The biggest behavioural change. Verify with the existing smoke test (`bun run smoke:noesis`) plus a populated-graph fixture (manually seeded) to confirm prior-conversation IUs surface in the bundle correctly.

### P2 — Documentation tightening (one PR, no code)

- §3: clarify Leaf / Container / Hybrid taxonomy in `extract-topics.md`; align `analyze-topic.md` Summaries rules.
- §4: add the "smell threshold" prose pointer to the same hierarchy section.
- §6: add the "Reading long transcripts" section to `extract-topics.md`.

Risk: minimal. Pure prompt evolution.

### Deferred

- §7 process slip — eliminated by P0+P1; revisit only if the pattern recurs.
- §8 dataset-specific judgement calls — explicitly out of scope.
- §9 message-length slips — harness-level, not skill-level.

---

## What this plan deliberately does *not* do

- It does not introduce a special-cased "empty graph fast path". The bundle contract works the same on empty and populated graphs; the agent has no reason to short-circuit.
- It does not enforce a maximum item count, a maximum subtopic depth, or a fixed split rule. Item count remains a smell, not a verdict.
- It does not add LLM-based transcript cleaning, ASR normalisation, or speaker-role inference. The prepare script remains a deterministic file consumer.
- It does not add a `replace_conversation` / re-merge path. Persistence is still in flight; the "clear DB and re-run" workflow remains adequate.
- It does not codify any of the second-run's specific topic placements (`T148:IU0`, `T31:IU0`, `KAT`'s 47 items) as rules. Those are individual judgement calls; the validator's warnings are the only systematic signal we add.
