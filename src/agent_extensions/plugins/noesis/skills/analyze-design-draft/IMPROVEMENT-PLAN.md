# `analyze-design-draft` — Improvement Plan

Source: post-mortem after the first production run of `noesis:analyze-design-draft` on the Polish design draft `wycena-dokumentów` (`design-doc.json` persisted under `~/Noesis/SDLC Sente/conversations/wycena-dokumentów/`). Date of run: 2026-04-25.

The pipeline produced sensible top-level outputs (252 fragments classified, 23 topics, 9 decisions, 3 attachments, 49 building blocks across 7 actors / 1 BC / 7 quality attributes), but the **design doc cannot be read back** — `read_design_doc` rejects every `DesignedBehaviour` row with `Invalid input: expected array, received null`. Because the skill is meant to iterate against a previously persisted design (Step 6 with `<design_doc_id>`), this regression bricks subsequent runs.

This document groups every reported issue with: **what the agent saw**, **root cause in code** (file:line where useful), **proposed fix**, and **open questions** that need the maintainer's decision before implementation.

---

## 1. 🔴 `read_design_doc` fails with `expected: array, received: null` for behaviour string-array fields

### Observed
After the first `save_design_doc` succeeded (the design was persisted, totals counter reported `15` top-level adds), calling `read_design_doc <id>` returned a Zod failure:

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
   `design-docs.repository.ts:34` declares `DesignedBehaviour(... input STRING[], output STRING[], used_building_blocks STRING[], ...)`. The save path always passes `[]` via `applyStringChangeSet` (`design-docs.repository.ts:1308`), but lbug/Kuzu reads the empty array back as `null`. This is the proximate cause of the validation failure.

2. **Read-side schema is too strict.**
   `BehaviourRowSchema` (`design-docs.repository.ts:101–112`) declares `input: z.array(z.string())` with no `nullable()` and no transform. A single `null` from the DB blows up the whole row parse — and because `z.array(BehaviourRowSchema).parse(rawRows)` is wrapped around it, the entire `fetchBehaviours` call fails. There is no row-level fallback.

3. **Agent-side: schema permits omitting ChangeSet fields entirely.**
   `shared-contracts/design-doc.ts:110–118`:
   ```ts
   input: StringChangeSetSchema.nullable().default(null),
   output: StringChangeSetSchema.nullable().default(null),
   usedBuildingBlocks: StringChangeSetSchema.nullable().default(null),
   ```
   The agent emits behaviours without `input` / `output` / `usedBuildingBlocks` when the source draft does not state them. Zod parses them as `null`. `applyStringChangeSet(null)` returns `[]`, which then collides with §1's storage quirk on the next read.

### Proposed fix

**Server-side, primary (must-have):** make the read tolerant.

```ts
// design-docs.repository.ts — BehaviourRowSchema
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

This unblocks every existing persisted design doc without a migration.

**Server-side, secondary (defence-in-depth):** stop relying on the storage layer to round-trip `[]`. On `CREATE`, persist as `null` when there are no items, and on `UPDATE` send `null` when the agent explicitly cleared the list. Combined with the read-side coalesce, the table is permitted to hold `null` and reads always produce `[]` to consumers.

**Server-side, additional:** apply the same `nullable().transform(() => [])` pattern to any future STRING[] / list column. Document the lbug quirk in a one-paragraph block in `design-docs.repository.ts` so the next person doesn't re-discover it.

**Skill-prompt-side:** reduce the chance of producing `null` ChangeSets at write time. In `references/design-doc-schema.md` Section 3, add an explicit invariant:

> Every ChangeSet field MUST be present in the JSON, even when empty. Emit `{ "added": [], "modified": [], "removed": [] }` rather than omitting the field. This applies to nested ChangeSets too (`behaviour.input`, `building_block.properties`, `bounded_context.modules`, …).

This is a belt-and-braces measure; the server fix is what actually makes correctness independent of agent diligence.

### Open questions
- **OQ-1.1**: Should the storage layer treat `null` and `[]` as equivalent, or should we forbid `null` and make the column NOT NULL (lbug/Kuzu-permitting)? The simpler answer is "always coalesce on read"; the cleaner one is "never let `null` enter the column". They aren't mutually exclusive.
- **OQ-1.2**: Are there other STRING[] columns (now or planned) that exhibit the same quirk? A quick grep for `STRING[]` in the schema string array would surface them.

---

## 2. 🔴 `save_design_doc` totals counter is misleading

### Observed
`save_design_doc` reported `totals.added: 15` after the first run. The actual persisted state contained:
- 7 actors, 1 BC, 7 quality attributes (the 15)
- 1 module, 49 building blocks
- 44 behaviours
- ~150 properties
- N rules, M scenarios

A user reading "15 added" has no signal that 250+ child entities were also written. Worse: when the agent re-saved the same doc with `id` set (an attempted repair), the totals stayed at `15` even though the recursive upsert had run and updated 44 behaviour rows.

### Root cause
`design-docs.service.ts:53–74` builds `totals` from only three top-level counters:
```ts
const totals = {
  added:
    applyResult.actors_added +
    applyResult.bounded_contexts_added +
    applyResult.quality_attributes_added,
  …
};
```

The repository's `ApplyResult` (`design-docs.repository.ts:155–166`) never tallies modules / building blocks / behaviours / rules / scenarios / properties. The agent has no way to verify a recursive save succeeded short of calling `read_design_doc`.

### Proposed fix
Extend `ApplyResult` and `CounterRef` to cover every entity layer; expose them as `totals.byKind` in `SaveDesignDocResult`:

```ts
{
  design_doc_id,
  totals: {
    added: <sum>, modified: <sum>, removed: <sum>,
    byKind: {
      actors: { added, modified, removed },
      bounded_contexts: { added, modified, removed },
      modules: { added, modified, removed },
      building_blocks: { added, modified, removed },
      behaviours: { added, modified, removed },
      rules: { added, modified, removed },
      scenarios: { added, modified, removed },
      properties: { added, modified, removed },
      quality_attributes: { added, modified, removed }
    }
  }
}
```

`upsertBoundedContext` / `upsertModule` / `upsertBuildingBlock` / `upsertBehaviour` need to receive a counter ref (or return a delta) so each recursion bumps the right bucket. Today they recurse but discard the count.

### Open questions
- **OQ-2.1**: Inline JSON or pointer to a tmp file? At ~9 layers × 3 buckets the payload is ≤500 bytes — inline JSON is fine and matches the existing `runInlineJsonTool` decision.

---

## 3. 🟡 Skill instructions for Step 6 contradict each other

### Observed
The agent had to choose between two contradictory instructions for persisting the design doc:

- `SKILL.md:126` — "Write the validated `DesignDoc` payload directly to `<design_doc_path>` … Then call MCP tool `noesis-graph:save_design_doc` with `path: <design_doc_path>`."
- `references/extract-design-model.md:47` — "`merge_document` orchestrates the actual graph persistence in Step 7. Do NOT call `save_design_doc` directly."

The reference also says to write the JSON to `<working_dir>/design_doc.json` (line 44), while SKILL.md tells the agent to write to `<design_doc_path>` (the user-provided repository location).

`merge_document` (`documents.service.ts:148–235`) does **not** persist design docs at all — it only handles topics, document fragments, decisions, and decision attachments. So the reference is wrong and the SKILL is right. But the agent has to read both files and reconcile.

### Root cause
`extract-design-model.md` was likely written before Step 6 was extracted from `merge_document` into a standalone `save_design_doc` tool. The reference was not updated.

### Proposed fix
Rewrite `extract-design-model.md` Save section to match SKILL.md:

```md
## Save

1. Write the validated DesignDoc JSON to <design_doc_path> (the user-provided
   repository location — this file is version-controlled).
2. Call `noesis-graph:save_design_doc` with `path: <design_doc_path>` to persist
   into the graph.
3. Edit <output_path> to set `design_doc_extracted: true`. If the server returned
   a generated id (first iteration), update `design_doc_id` in <output_path>.

`merge_document` (parent skill Step 7) does NOT persist the design doc — it only
handles topics, fragments, decisions, and attachments. `save_design_doc` is what
persists the model.
```

### Open questions
- **OQ-3.1**: Should we go further and have `merge_document` *call* `save_design_doc` when a `design_doc.json` exists in `working_dir`, so the skill stays "one terminal merge"? Probably no — having two distinct commits (model first, knowledge graph second) is cleaner; the user can inspect / edit the persisted design before fragments get attached. Confirm before changing.

---

## 4. 🟡 Decision attachments are noisy (≤5 fragments per attachment is the right ceiling)

### Observed
- Decision `5fd216f8` (RB-1 invariant): 19 fragments attached. Most are tangential mentions in coverage tables; the load-bearing evidence is ~3 (the RB-1 statement itself, the `SourceDocumentLineId` field declaration, the `CreatePriceState` handler).
- FIFO decision: 8 fragments. About half are tangential.

When the next analysis surfaces this decision via `list_decisions` or `get_topic_for_document_review`, the user sees a wall of weakly-supportive snippets instead of the 3–5 strongest. Quality of `read_decision` UX degrades linearly with attachment count.

### Root cause
`references/analyze-document-topic.md` (which governs Step 5 attachments) does not cap evidence count. The agent — given no constraint — over-attached.

### Proposed fix
Edit `references/analyze-document-topic.md` to add an explicit cap:

> When attaching to an existing decision, attach **at most 5 fragments per slot per decision** — pick the most directly supportive evidence. If more than 5 fragments touch the decision, prefer ones that:
>
> 1. State the rule / option / consequence explicitly (verbatim wording wins).
> 2. Show a concrete code-side artefact (field, handler, type) that anchors the rule.
> 3. Cover a distinct perspective (don't attach the same paragraph twice).
>
> Tangential mentions in coverage tables, recap sections, or table-of-contents
> entries should not be attached.

Optional server-side guard: emit a warning in `merge_document`'s response when an attachment exceeds N fragments, so the agent can self-correct on the next iteration.

### Open questions
- **OQ-4.1**: Hard cap (server rejects >5) vs. soft cap (rule in the prompt)? Soft is friendlier to edge cases (an exceptionally rich decision); hard is safer. Recommend soft + warning.

---

## 5. 🟡 Topic granularity is uneven

### Observed
- "Rejestracja delt" — 30 items. Could naturally split into _command surface_, _storno algorithm_, _propagation algorithm_.
- "Zdarzenia domenowe modułu" — 1 item. Almost certainly should fold into a parent.
- "Diagram struktury" (12 items) overlaps with the PriceState / Delta topics, and probably should not exist as a sibling.

The Goldilocks loop in Step 2 picked "just-right" granularity from the existing graph, but Step 3's _new_ topics (driven by the cleaned doc's headings) didn't get the same scrutiny — headings became topics 1:1.

### Root cause
`references/extract-document-topics.md` instructs the agent to **reuse before promote** but does not ask the agent to **balance** the resulting topic set. There's no "after assigning categories, look at the topic-size distribution and resplit / merge outliers" step.

### Proposed fix
Add a balancing micro-step after Step 3, before Step 5 starts:

> ### Step 3.5: Topic-size pass
>
> Look at the `topics[*].items.length` distribution.
>
> - **Singletons** (≤1 item): consider folding into the closest semantically-adjacent topic. Only keep a singleton when the item is genuinely orthogonal.
> - **Outliers** (≥3× the median): consider splitting along axes you already see in the underlying fragments (command vs algorithm; happy-path vs edge-case; data-model vs behaviour).
> - Update `output.json:potential_topics` and re-tag fragment `topic_id`s in `output.json:fragments` accordingly.

This is a soft heuristic, not a strict rule — outlier topics are sometimes correct (a central algorithm legitimately has many fragments). The wording should be "consider", not "must".

### Open questions
- **OQ-5.1**: Is there a sensible automated split (e.g. "topic with >20 items"), or should the agent always reason from semantic axes? Probably the latter — counts are a smell, not a verdict.

---

## 6. 🟡 Fragment categorization underused

### Observed
- Only 18 fragments tagged `Position+Argument` (RB-style invariant rules).
- Only 4 tagged `Decision+Information` (DPs / DTs).
- Many architectural choices in the body (storno-by-flag, append-only motive, "od najwekszego" FIFO strategy) live in pure `Information` paragraphs and never surface as decisions.

### Root cause
The category definitions in `references/extract-document-topics.md` lean toward "what is asserted" rather than "what was chosen". Soft-spoken design choices in narrative form ("…ponieważ…", "…zamiast…", "…zdecydowaliśmy się na…") are easy to miss when the agent scans for explicit `Decision`-shaped paragraphs.

### Proposed fix
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

### Open questions
- None.

---

## 7. ⏱️ Time-efficiency optimisations

These are not correctness issues; they are wasted work the agent observed.

### 7.1 Three full-doc Reads where a tree + targeted snippet would do
The cleaned doc is ~50 KB. The agent did three Reads to span it (lines 1–350, 350–700, 700–1050, 1050–1402). `<section_tree_path>` (~1 KB) plus selective fragment reads from `output.json` would have answered the same questions. ~30 s.

**Proposed fix:** add to `SKILL.md` Step 3:

> Prefer `<section_tree_path>` for structural questions and selective fragment
> reads from `output.json` for content questions. Only read `<cleaned_path>`
> end-to-end when you need flowing narrative across sections.

### 7.2 Three sequential Python scripts where one would do
`assign_topics`, `review_topics`, `build_design_doc` ran sequentially. They share read inputs (`output.json`, `cleaned_path`) and could be one script with three subcommands or one orchestrator. ~15 s.

**Proposed fix:** none in the skill — this was an agent-side improvisation, not a documented step. If we want to enshrine the pattern, ship a single "post-process" script under `${CLAUDE_PLUGIN_ROOT}/scripts/design-draft/`. Otherwise leave it.

### 7.3 Bypassed `get_topic_for_document_review` for 21 of 23 topics
The skill's Step 5 mandates a per-topic loop via `get_topic_for_document_review`. The agent batched the summary writes for 21 topics directly, calling the tool only twice. This was an _intentional_ optimisation that worked, but it skipped the formal contract.

**Proposed fix:** offer a sanctioned batch path:

> If `get_topic_for_document_review` would return only fragments from the
> current document (no prior-document context to merge), the agent MAY compute
> summaries directly from `output.json` and skip the round-trip. The tool's
> job — surfacing prior-document context — is moot in that case.

This makes the optimisation explicit instead of implicit. Today the rule "Do not parallelise. Each iteration depends on the previous edit." is true, but blunt — it doesn't acknowledge the case where the iteration is a no-op.

### 7.4 Normalisation happened post-save
The agent wrote the design doc, called `save_design_doc`, hit the Zod failure, then patched the file. Build-time invariants would have caught this earlier.

**Proposed fix:** addressed by §1 — the server should not require the agent to be defensively diligent. With the read-side coalesce, the agent's omitted-ChangeSet output round-trips correctly.

### Open questions
- **OQ-7.1**: Are the ~30 s + 15 s wins worth the doc churn? Probably yes — they nudge the agent toward the cheaper path without forcing it.

---

## Implementation plan (recommended sequencing)

### P0 — Unblock iteration on existing design docs (server, one PR, ~50 LOC)
- §1 server fix: `BehaviourRowSchema` strings array fields → `nullable().transform(v => v ?? [])`. Add a regression test that round-trips a behaviour with all-empty `input/output/usedBuildingBlocks` through `save_design_doc` → `read_design_doc`.
- §3 doc fix: rewrite `extract-design-model.md` Save section. (Pure docs.)

### P1 — Better feedback (server, one PR)
- §2: extend `ApplyResult` to count every layer, return `byKind` totals.
- §1 secondary: optional `null` round-trip if we want defence-in-depth.

### P2 — Quality of analysis (skill prompts, one PR, no code)
- §4: cap fragment attachments at 5 in `analyze-document-topic.md`.
- §5: add Step 3.5 topic-balancing pass to `extract-document-topics.md`.
- §6: tighten Decision / Position cheat-sheet with narrative-style examples.

### P3 — Efficiency nudges (skill prompts, one PR, no code)
- §7.1: prefer section tree + selective reads.
- §7.3: sanction the batch path when `get_topic_for_document_review` adds no prior-document context.

### Out of scope (for now)
- §7.2: a single "post-process" script. Premature; revisit after P2 lands and we know whether the multi-script pattern recurs.
- §1 OQ-1.1: storage NOT NULL constraint — only worthwhile if we touch the schema for another reason.

---

## Open questions summary

| ID | Question | Blocking |
|----|----------|----------|
| OQ-1.1 | Storage NOT NULL vs read-side coalesce? Both? | P0 design |
| OQ-1.2 | Other STRING[] columns with the same quirk? | P0 audit |
| OQ-2.1 | `byKind` inline vs file? | P1 design |
| OQ-3.1 | Should `merge_document` invoke `save_design_doc` automatically? | P0 design |
| OQ-4.1 | Hard cap (server rejects) vs soft cap (prompt)? | P2 design |
| OQ-5.1 | Automated topic resplit thresholds, or pure heuristic? | P2 design |
| OQ-7.1 | Worth the doc churn for ~45 s saved per run? | P3 confirmation |
