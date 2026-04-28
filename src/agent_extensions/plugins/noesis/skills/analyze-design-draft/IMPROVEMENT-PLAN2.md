# `analyze-design-draft` — Improvement Plan 2

Source: post-mortem after the second production run of `noesis:analyze-design-draft`, this time on `Dokumentacja_v3.md` (`conversations/wycena-dokumentów/Dokumentacja_v3.md`). Working dir `/tmp/noesis/noesis-doc-a20c7932-…`. Design Doc persisted as `work_items/wycena-dokumentow.json` (id `ca6a6da8-0b09-4a76-a703-36a985987632`).

The pipeline reached the end (document merged, 4 new topics, 24 updated, Design Doc saved and validated), so the P0 unblockers from `IMPROVEMENT-PLAN.md` are confirmed working. This run's failures are about **output quality**, not pipeline correctness — the produced Design Doc is too shallow for an AI coding agent to implement from, and topic items are diluted with structural noise.

The goal of this document is therefore: turn the observed quality failures into concrete edits in the skill prompts, prep tooling, and schemas.

## TL;DR

- **68% of rules have no `description`, 15% are tautological** (83% effectively unusable for an AI coding agent).
- **Behaviour `description` averages 150 chars** (~25 words) — far too thin to drive code generation; no algorithmic detail, no diagrams.
- **53 building blocks in one Bounded Context, 0 modules** — flat list, hard to navigate.
- **35% of non-Irrelevant fragments are pure structural headers** (`**Warunki wstępne:**`, `*Wariant A:*`, …) — `prepare.ts` emits them as standalone fragments, the agent assigned them to topics, and now they pollute search.
- **0 `Decision`-categorised fragments, 0 attachments, 0 new decisions** — the document is full of narrative decisions ("FIFO jako jedyna polityka", "WZ nie przechowuje ceny", …) and none were captured.
- Step 5 was executed as a **single batch** instead of the iterative loop the skill mandates.

## Refined findings (post user review)

Hard numbers from `work_items/wycena-dokumentow.json` and `output.json`:

| Metric | Value | Threshold / expectation |
|---|---|---|
| Rules with no `description` | **48 / 71 (68%)** | 0% |
| Rules with tautological description (<60 chars) | **11 / 71 (15%)** | <10% |
| Rules with meaningful description | 12 / 71 (17%) | >90% |
| Average behaviour description length | 150 chars | ≥500 chars + algorithm |
| Longest behaviour description | 202 chars (`OpenPeriod`) | — |
| Building Blocks in BC `WycenaDokumentówMagazynowych` | 53 | — |
| Modules inside BC | **0** | 4–6 |
| Non-Irrelevant fragments ≤60 chars | **98 / 282 (35%)** | <10% |
| Fragments that are bare structural headers | **94** | 0 |
| New topic "Uprawnienia w module wyceny" — short headers among 67 items | **29 / 67 (43%)** | <10% |

## What went well

1. **Goldilocks on topics.** Drill-down through root → subtopics → sub-subtopics, decision to reuse 24 existing topics instead of promoting new ones. The 4 new topics sit sensibly in the hierarchy (`Zamknięcie okresu` under `Wycena okresowa`, `Pending blokady` under `Set-lock`, etc.).
2. **Design Doc broad and validated.** 53 building blocks, 14 actors, 6 quality attributes. Reference validation (input/output/usedBuildingBlocks/actor) passed without dangling refs on the first try.
3. **Schema-conformant JSON.** ChangeSets correct everywhere (`added`/`modified`/`removed`), camelCase, full Aggregate/Entity/VO/Event/Command/Service/Query classification.
4. **Section → topic mapping mostly accurate.** Business rules, glossary, scenarios, and UCs landed in plausible topics; the mapping was declarative (`SECTION_MAP` table) — easy to audit.

## Findings — root causes and fixes

Each finding is paired with its location in the codebase and the agreed fix. Where multiple layers contribute, the fix is split across them.

### F1 🔴 Rule `description` is empty in 68% of cases, tautological in 15%

#### Observed
48 of 71 rules have no `description`. Examples:

```
PriceState / RegisterDelta / "Realna delta stornuje wszystkie prognozy w tej samej kategorii kosztu" — no description
PriceState / ManuallyChangePrice / "Wymaga dedykowanego uprawnienia" — no description
SplitPropagationService / "Brak cykli zapewniony przez nowe stany cenowe na ZZ i MM+" — no description
DeltaPropagationService.PropagateDelta / "Krawędź Disassembly: delta przeliczana przez współczynnik krawędzi" — no description
```

The 11 tautological ones either parrot the name (`Blokady muszą nadążyć za splitem` → `"Referencje blokady aktualizowane do nowych stanów cenowych."`) or restate rationale without algorithm (`Storno + nowy zapis (nie update)` → `"Gwarantuje audyt i prosty zrzut do hurtowni danych."`).

#### Root cause
- **Schema permits null.** `shared-contracts/design-doc.ts:59` — `description: z.string().nullable().default(null)`. There is no quality gate.
- **Reference doc is silent on shape.** `references/extract-design-model.md` lists rules in step 4 but never describes what a rule's description should contain. There is no "good vs bad rule" example.
- **No save-side validation.** `save_design_doc` (`design-docs.service.ts:91`) accepts any schema-valid JSON.

#### Fix
1. **`shared-contracts/design-doc.ts`** — make `DesignedRule.description` non-nullable, required: `description: z.string().min(80)`. Same for newly created rules in `added` and `modified`. (Empty strings are rejected.)
2. **`references/extract-design-model.md`** — add a "Writing rules" section with the required structure and a worked example:

   > Every `Rule` MUST have a `description` of at least 80 characters that an AI coding agent can implement from. Structure it as:
   >
   > - **Trigger** — when the rule fires.
   > - **Pre-conditions** — observable state that must hold before.
   > - **Algorithm** — the steps (or formula) the rule prescribes.
   > - **Post-conditions** — observable state after.
   > - **Edge cases** — boundary conditions, rounding, error paths.
   >
   > For algorithmic rules, give a short pseudocode block or a numbered step list. Tautologies that paraphrase the rule's `name` are rejected. Pure rationale without an algorithm is rejected.
   >
   > **Good** (rule name `"Realna delta stornuje wszystkie prognozy w tej samej kategorii kosztu"`):
   > > Pre: a real delta is registered in cost category K on PriceState P. Algorithm: find every active (non-storno) delta on P with `flag = forecast` AND `costCategory = K`; for each, create a storno delta (`stornoOf = original_id, amount = -original_amount`) — never UPDATE the existing delta; then register the new real delta. Post: zero active forecasts in K on P; sum of delta amounts in K equals the new real amount. Edge: when real amount equals the forecast sum, effective change is zero, but storno deltas must still be recorded for audit. All operations atomic in one transaction.
   >
   > **Bad** (`"Storno + nowy zapis (nie update)" → "Gwarantuje audyt i prosty zrzut do hurtowni danych."`) — pure rationale, no algorithm, no shape of the storno record.

3. **`design-docs.service.ts:saveDesignDocFromFile`** — after Zod parse, run a quality check that walks every `DesignedRule` (existing or newly added) and rejects the save with `{ status: "Error", message: "Rule '<name>' description is missing or shorter than 80 chars" }`. Reject the whole save — fail fast, force the agent to fix.

### F2 🔴 Behaviour `description` averages 150 chars, no algorithm

#### Observed
Mean behaviour description length is 150 chars (~25 words), max 202 (`OpenPeriod`). All 44 behaviours have ≤200-char descriptions. Example:

```
PriceState.RegisterDelta:
"Rejestracja delty na stanie cenowym (FZ, KZ, SAD, transport, retro,
prace dodatkowe, ręczna). Propagacja przez graf do stanów pochodnych.
Storno prognoz przy delcie realnej."
```

The agent could not write code from this — the description doesn't say whether to validate the closed period before propagating, whether storno happens before or after the new delta is saved, what the transactional boundary is, what events fire, what shape the input has.

#### Root cause
Same trio as F1: the schema allows null (`shared-contracts/design-doc.ts:108`), the reference doc gives no template (`references/extract-design-model.md` step 4 mentions `behaviours` only structurally), and `save_design_doc` does not validate description depth.

The skill prompt also never suggests a sequence-diagram representation, even though for `application_service` behaviours (split propagation, period close, FIFO allocation) prose alone is hard.

#### Fix
1. **`shared-contracts/design-doc.ts`** — `DesignedBehaviour.description: z.string().min(400)`. Required and non-empty.
2. **`references/extract-design-model.md`** — add a "Writing behaviours" section:

   > Every `Behaviour` MUST have a `description` of at least 400 characters that lets an AI coding agent implement it without follow-up questions. The description SHOULD contain (in order):
   >
   > 1. **Input** — the message/command/event with its fields and source.
   > 2. **Validation / preconditions** — what to check before any state change, with the rejection branch for each check.
   > 3. **Steps** — numbered list of state changes / service calls / writes, in order, with the transactional boundary called out explicitly.
   > 4. **Output** — emitted events/messages and what the caller observes.
   >
   > For behaviours of `type: application_service` OR with `usedBuildingBlocks.added.length ≥ 3`, embed a **mermaid sequence diagram** in the description showing the interaction between the participating Building Blocks. Sequence diagrams are first-class — the agent reading this design doc renders them.
   >
   > Worked example for `PriceState.RegisterDelta` (≥10× the current text): see template below.

3. **`design-docs.service.ts:saveDesignDocFromFile`** — extend the F1 quality check: every `DesignedBehaviour` must have `description.length ≥ 400`. Behaviours of `type: "application_service"` or with `≥3` entries in `usedBuildingBlocks.added` should additionally contain `\`\`\`mermaid` — when missing, emit a **warning** (not an error) on the save response. Hard-blocking missing diagrams is too strict for a first iteration; visibility is enough.

### F3 🟡 Modularisation — 53 building blocks, 0 modules

#### Observed
53 building blocks sit directly under `WycenaDokumentówMagazynowych`. Zero modules.

#### Root cause
1. **`references/design-doc-schema.md:111`** — *"Do not promote a heading to a Module unless a separate Building Block sub-heading is nested under it."* The agent read this as "do not introduce modules unless explicit". The rule is meant to prevent **inventing modules from headings**, not to forbid **logical grouping**.
2. **No saturation rule.** When the BC has 50 BBs, there is no instruction telling the agent to introduce modules. Reference doc treats modules as optional.
3. **`save_design_doc` is silent** about flat-BC saturation.
4. The agent had a natural module skeleton sitting in the topic graph (`Architektura modułu`, `Podział i propagacja`, `Set-lock`, `Wycena okresowa`, `Numeracja delt`, …) and didn't use it.

#### Fix
1. **`references/design-doc-schema.md` Section 6** — soften the existing prohibition and add a saturation rule:

   > Do not invent module names from arbitrary headings. But once a Bounded Context contains more than ~15 Building Blocks, group them into 3–7 Modules along the natural cohesion axes — typically the topic structure already in the graph. Reuse topic names rather than inventing fresh module names. A Module with fewer than 3 Building Blocks is a smell; either fold it back into the BC or merge it with a sibling.

2. **`references/extract-design-model.md` step 3** — add a check before listing Building Blocks:

   > Before enumerating Building Blocks under a Bounded Context, look at the existing topic tree pulled in Step 2 (`potential_topics`). Topics directly under the document's main topic are a natural module skeleton. Use them. Skip this when the BC has fewer than ~15 Building Blocks — flat is fine.

3. **`design-docs.service.ts:saveDesignDocFromFile`** — emit a warning (not error) on the save response when any Bounded Context has `>20` direct `buildingBlocks.added` and 0 `modules.added`. Structured as `warnings: ["Bounded Context 'X' has 53 building blocks and no modules — consider grouping."]`.

### F4 🟡 35% of non-Irrelevant fragments are bare structural headers

#### Observed
98 of 282 non-Irrelevant fragments are ≤60 chars, and 94 of those are pure structural markers (`**Warunki wstępne:**`, `*Wariant A: ...*`, `**Aktorzy:** System`, `**Powiązane scenariusze:**`, etc.). Worst offenders by topic:

- `Uprawnienia w module wyceny`: 29 / 67 (43%)
- `Zamknięcie i otwarcie okresu księgowego`: 28 / 61 (46%)
- `Podział stanu cenowego i propagacja`: 23 / 55 (42%)

#### Root cause
1. **`scripts/document/fragment-markdown.ts`** parses Markdown deterministically — every AST element (paragraph / list / table / blockquote / code_block) becomes one fragment. A `**Warunki wstępne:**` paragraph followed by a blank line and a bullet list emits **two** fragments: the lone bold paragraph and the list. The list carries the meaning; the paragraph is a label.
2. **Step 3 had no Irrelevant override for header-shape paragraphs.** The reference doc allows `Irrelevant`, but provides no regex/heuristic, so the agent only marked the two `---` separators.

#### Fix
This is a **prep-tooling fix** (objective — runs the same way every time) plus a **Step 3 prompt fix** (catches whatever escapes prep).

1. **`scripts/document/fragment-markdown.ts`** — when a `paragraph` block ends with `:` (or matches `^\*\*[^*]+\*\*:?$`, `^\*[^*]+\*$`) AND the next non-blank lines start a `list` / `blockquote` / `table` block, emit a **single combined fragment** spanning both. The combined fragment's `kind` is the trailing block's kind (`list` / `blockquote` / `table`); its `text` includes the lead-in paragraph plus the body.

   This collapses `**Warunki wstępne:** + bullets` and `*Wariant A: ...* + bullets` into one semantically meaningful fragment. Update `consumeBlock` for paragraphs to peek ahead, and add a test case per block kind.

2. **`scripts/document/fragment-markdown.ts`** — a paragraph with no following block (a true orphan label like `**Powiązane scenariusze:**` at the end of a section) gets `kind: "structural"`. Add `"structural"` to `DocumentFragmentKindSchema` and treat it as default-Irrelevant in Step 3.

3. **`references/extract-document-topics.md`** — extend the `Irrelevant` definition:

   > In addition to off-topic boilerplate, mark as `Irrelevant`:
   >
   > - Fragments of `kind: "structural"` (the prep tool emits these for orphan section markers).
   > - Any fragment whose trimmed text is shorter than 80 chars AND matches a header pattern: `^\*\*[^*]+:?\*\*$`, `^\*[^*]+\*$`, `^\*\*Aktorzy:\*\*`, `^\*\*Cel:\*\*`, `- Scenariusz [A-Z]+-\d+` cross-link bullets, etc.
   > - Pure cross-reference lists ("see also", "powiązane scenariusze", section-of-contents bullets).
   >
   > These fragments contribute zero domain content; carrying them in topic items poisons search and inflates topic size.

4. **`scripts/document/fragment-markdown.test.ts`** — add tests for: (a) `**Header:** + list` collapses into one `list` fragment; (b) `*Wariant A:* + bullets` collapses; (c) orphan `**Powiązane scenariusze:**` paragraph emits `kind: "structural"`.

### F5 🟡 Glossary list (17 bullets) becomes one fragment, attached to 15 topics

#### Observed
`Słownik pojęć / Dokumenty i obiekty` is one bullet list with 17 definitions. Step 3 attached it to 15 different topics (DEFN, DELTA, SPLIT, LOCK, PEND, CLOSE, …) because each bullet matches a different topic. Net effect: 15 topics carry the entire glossary as one item, and per-topic search returns wall-of-glossary.

#### Root cause
`fragment-markdown.ts:consumeBlock` for `kind=list` consumes the whole list as one fragment. There is no per-bullet split, even when bullets are independent definitions.

#### Fix
**`scripts/document/fragment-markdown.ts`** — when a list's section path contains "Słownik" / "Glossary" / "Definitions" (case-insensitive), OR every bullet matches a definition pattern (`^\s*[-*+] \*\*[^*]+\*\*[:\.\—]`), split each bullet into its own `list_item` fragment. Otherwise keep the existing collapse-to-one behaviour.

This is opt-in by content shape — it does not affect non-glossary lists.

### F6 🟡 Decision attachments: 0 / 0 — narrative decisions invisible

#### Observed
`merge_document` returned `decisions_added: 0, decision_attachments: 0`. The document contains many narrative decisions (`"Na starcie obsługiwane wyłącznie FIFO"`, `"Brak mechanizmu uśredniania cen"`, `"WZ nie przechowuje ceny — zna jedynie referencje"`, `"przetwarzanie szeregowe — nie równolegle"`). None were caught.

#### Root cause
1. **Step 3 has no checkpoint.** The agent classified rule sections as `Position` and never as `Decision`. Reference doc does cover narrative decisions (`extract-document-topics.md:38-44`), but there is no required tally that would have flagged "0 decisions" as wrong.
2. **`get_topic_for_document_review`** sets `has_decision_units: false` for every topic when no fragment is `Decision`-categorised. Step 5 then short-circuits the entire ATTACH/CREATE block per topic — by design, but the silent skip hides the upstream miscategorisation.

#### Fix
1. **`references/extract-document-topics.md`** — add a checkpoint at the end of "Topic assignment":

   > After categorising every fragment, count categories. For any document that contains an explicit "Reguły biznesowe" / "Decisions" / "ADR" section heading, **at least 30% of fragments in those sections must be categorised `Decision`** (alone or combined with `Information` / `Argument`). If your tally falls short, re-read those sections with the narrative-decision examples in mind — almost certainly you classified narrative decisions as `Position`.

2. **`scripts/document/check-decision-coverage.ts`** (new) — given an `output.json`, count fragments per section path and report sections matching a `*ADR*|*Decision*|*Reguły*` pattern with `<30%` Decision-categorised fragments. Run it after Step 3 as a self-check; print a warning to stderr but do not fail.

3. **`SKILL.md` Step 3** — add: *"Before moving on, run `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/document/check-decision-coverage.ts <output_path>`. If it warns about a section with low Decision coverage, revisit those fragments before Step 4."*

### F7 🟡 Step 5 was executed as a single batch instead of the iterative loop

#### Observed
The agent called `get_topic_for_document_review` once (got the first topic), wrote a `write_summaries.py` Python script with 28 summaries pre-baked, ran it, then called the tool a second time (got `Done`). The skill explicitly says **"Do not parallelize"** and the prior-document `[from <doc title>]` fragments are only revealed via the tool — bypassed.

#### Root cause
The agent optimised for time. 28 sequential round-trips with a 250-KB `output.json` is slow because each Edit uploads the whole file. The skill asks for one tool call per topic, but provides no batch-friendly path.

#### Fix
Sanction a batch path with mandatory per-topic verification.

1. **New MCP tool `list_unreviewed_topics_for_document`** in `documents.mcp.ts`:

   > Reads `output_path`, returns one tmp file containing every unreviewed topic's enriched view (current + prior-document fragments, with `[from <doc>]` markers) in a single Markdown bundle. Same per-topic shape as `get_topic_for_document_review`, just multiple sections joined by `<!-- topic_id: ... -->` separators. Lets the agent batch summary writes safely.

   Implementation: extend `documents.service.ts` with `getAllTopicsForDocumentReview(outputPath)` that loops the existing `getTopicForDocumentReview` logic for every unreviewed topic.

2. **`SKILL.md` Step 5** — replace "Do not parallelize" with:

   > Two execution modes:
   > - **Iterative** (default, ≤10 topics): one `get_topic_for_document_review` call per topic, edit `output.json` between calls.
   > - **Batch** (>10 topics): one `list_unreviewed_topics_for_document` call returns every topic's enriched view; write all summaries / decisions in one Edit pass over `output.json`. Per-topic verification is still mandatory — for each topic, confirm that `[from <doc>]` prior-document fragments (if any) were folded into the summary.

3. **`references/analyze-document-topic.md`** — append a "Batch mode" subsection mirroring the SKILL.md guidance.

### F8 🟢 Custom Python scripts emerged as a coping mechanism

#### Observed
The agent wrote three Python scripts in `/tmp/.../noesis-doc-…/`: `build_topics.py` (used — assigned 284 fragments × 28 topics), `write_summaries.py` (used — Step 5 batch), `update_topic.py` (**written and never used** — scaffolded for a per-topic loop that didn't happen).

#### Root cause
Editing `output.json` (~250 KB) with the Edit tool is impractical for bulk updates — hundreds of precise edits. There is no MCP tool for "set categories+topic on N fragments", and the skill says "Edit `output.json` with Edit/Write" without acknowledging the size cliff.

#### Fix
1. **`SKILL.md` Step 3** — add a "Bulk edit pattern" subsection:

   > For documents with >100 fragments, editing `output.json` line-by-line is impractical. Write a short Python helper (load JSON → mutate in memory → dump JSON) and invoke it via Bash. Save the helper next to `output.json` so the next iteration can re-use it. Do not write helpers speculatively — only write them when you have a concrete bulk operation to run.

2. **No new MCP tool for bulk fragment assignment** — this stays an agent-side helper. A server tool would lock down the shape; helpers stay flexible.

### F9 🟡 Over-tagging: new topic "Uprawnienia w module wyceny" carries 67 items

#### Observed
The new topic `Uprawnienia w module wyceny` collected 67 fragments. The document has only ~5 fragments where permissions are the primary subject; the rest are sections that *mention* permissions as a side detail (UC variants, GUI dialogs, scenarios). The topic looks dominant in the graph but is mostly noise.

#### Root cause
The agent's `SECTION_MAP` assigned `PERMS` to every section that wrote about permissions, regardless of whether permissions were the section's primary subject. Step 5's coherence check would have caught this — but Step 5 ran in batch (F7) and skipped the per-topic critical pass.

#### Fix
1. **`references/extract-document-topics.md`** — strengthen the "Topic assignment" rule:

   > A topic is the *primary subject* of a fragment, not a *side mention*. If the fragment's main concern is X and it incidentally references Y, assign it to the topic for X — not for Y. A topic that grows >40 items is a smell: re-check whether half of them are side-mention assignments.

2. **`references/analyze-document-topic.md` (Step 5 coherence check)** — add:

   > Topics with >40 items receive an extra coherence pass: read every item and verify the topic is the fragment's *primary* subject. Items that are side mentions belong elsewhere — reassign them via the existing reassignment mechanism. Tally the count before and after; record both in the summary's review notes.

3. **F7's batch mode** — already requires per-topic verification, which exposes oversaturated topics.

## Implementation plan

### P0 — Schema and quality gates (server + contracts, one PR)

- **F1** make `DesignedRule.description` required (`z.string().min(80)`); update `extract-design-model.md` with the rule template; add server-side rejection in `saveDesignDocFromFile`.
- **F2** make `DesignedBehaviour.description` required (`z.string().min(400)`); update `extract-design-model.md` with the behaviour template + mermaid trigger; add server-side rejection. Mermaid is a `warning`, not an error.
- **F3** soften `design-doc-schema.md:111` to allow modular grouping at saturation; add `>20 BB / 0 modules` warning to `saveDesignDocFromFile`.
- Update `references/design-doc-schema.md` Section 2 to drop `.nullable()` from rule/behaviour `description`.
- Regression tests: a Design Doc that ships a rule without description, or a behaviour <400 chars, must fail `save_design_doc` with a clear error. A flat 25-BB BC must come back with one warning.

### P1 — Prep tooling (TS, one PR)

- **F4** in `fragment-markdown.ts`: collapse `**Header:** + list/blockquote/table` into one fragment of the trailing block's kind. Tag truly orphan header paragraphs as `kind: "structural"`. Extend `DocumentFragmentKindSchema` accordingly.
- **F4** in `extract-document-topics.md`: add the `Irrelevant`-by-pattern guidance.
- **F5** in `fragment-markdown.ts`: split glossary lists per-bullet (auto-detect by section path or bullet shape).
- Tests for every shape transition (`prepare.test.ts`, `fragment-markdown.test.ts`).

### P2 — Skill prompts (no code, one PR)

- **F6** add the Decision-coverage checkpoint to `extract-document-topics.md` plus the `check-decision-coverage.ts` helper script and SKILL.md hook.
- **F7** add the new `list_unreviewed_topics_for_document` MCP tool and rewrite `SKILL.md` Step 5 + `analyze-document-topic.md` to document the iterative-vs-batch modes, including the per-topic verification requirement.
- **F8** add the "Bulk edit pattern" subsection to `SKILL.md` Step 3.
- **F9** strengthen the topic-assignment rule in `extract-document-topics.md` and add the >40-item coherence pass to `analyze-document-topic.md`.

### Out of scope for now

- **Subagenting Step 5** (one Haiku/Sonnet agent per topic, fan-out 28×). Worth measuring once F7's batch path is in. Premature otherwise.
- **Cleaning up the existing `wycena-dokumentow.json`**. The Design Doc was saved with shallow descriptions; re-running the skill against this document with the new quality gates will flag and reject. That's the intended forcing function — re-extraction will produce a usable design.
- **A dedicated MCP bulk-fragment-assignment tool.** F8's helper-script pattern is good enough; locking the shape down server-side would constrain experimentation.

## Sequencing notes

- P0 changes the schema in a backward-incompatible way (rule/behaviour descriptions become required). The graph DB is cleared between iterations; no migration needed. Existing Design Doc JSON files in the repo (e.g. `work_items/wycena-dokumentow.json`) will fail re-save until their descriptions are filled in. That is the correct user signal.
- P1 prep-tooling changes affect fragment offsets. Any pre-existing `output.json` from runs before P1 will reference offsets the new prep tool no longer produces. Treat each `output.json` as run-scoped and discard between runs — already true in practice.
- P2 prompt changes are pure docs and ship safely after P0/P1 land.

## Diagnostic appendix

The deep-dive sections from the original post-mortem are preserved below. They informed the fix list above; keep them for future reviews of `wycena-dokumentow` runs and for cross-referencing patterns.

### A. Rules without descriptions (68%)

User comment: *"Many rules don't have descriptions. Rule always should have a description. Description should be short but comprehensive so that AI coding agent have enough content to implement it."*

The agent treated `name` as self-explanatory and skipped `description`. An AI coding agent generating code from this rule needs **pre-condition / algorithm / post-condition / edge cases** — the name alone is not enough. Captured in F1 with the "good vs bad rule" example.

### B. Tautological descriptions (15%)

User comment: *"Some rules have strange descriptions e.g. 'Referencje blokady aktualizowane do nowych stanów cenowych.' in rule 'Blokady muszą nadążyć za splitem'. Such description isn't helpful for implementation because the context is missing."*

11 rules paraphrased their own name or stated rationale without algorithm. Worst cases:

| Rule name | Description | Why bad |
|---|---|---|
| Blokady muszą nadążyć za splitem | "Referencje blokady aktualizowane do nowych stanów cenowych." | Repeats the name. Missing: what about `lockedQuantity`? How to split between SC-A and SC-B? Crossing the locked/free boundary? |
| Storno + nowy zapis (nie update) | "Gwarantuje audyt i prosty zrzut do hurtowni danych." | Rationale, not algorithm. Missing: storno record shape (`stornoOf`)? Reference to the original delta? |
| Częściowa korekta wymaga splitu | "Gdy delta dotyczy tylko części ilości stanu cenowego." | Repeats the name. Missing: how does the system recognise "partial"? Operator-driven or system-inferred? |
| Pending nie ma PriceStateId | "Czeka na pierwsze przyjęcie." | Repeats the name. Missing: what relation does the pending point at (item+warehouse)? How is it found at activation? |
| Anulowanie sprzedaży „pod wodą" leży po stronie OMS | "Nie modułu Wyceny." | Tautology. Missing: where exactly in OMS, what contract, what event? |

Captured in F1.

### C. Behaviour descriptions too shallow

User comment: *"Descriptions for Behaviors should have enough information so that AI agent can implement it without mistakes. This description should be shortly but comprehensively describe algorithm. It may contain mermaid sequence diagram for complex behaviors (especially in application services)."*

Mean 150 chars, max 202. Captured in F2.

Worked example for `RegisterDelta` (~10× current length, the kind of depth F2 mandates):

1. Input: `DeltaRegistrationRequested` with `priceStateId`, `amountPerUnit`, `effectiveDate`, `costCategory`, `sourceDocumentReference`, `flag`.
2. Validation: (a) the accounting period containing `effectiveDate` must be open; (b) if `flag = forecast` AND a delta with `flag = real` already exists in this category — reject; (c) if `flag = forecast` AND an active forecast already exists in this category — reject (or replace, depending on policy).
3. If `flag = real` and forecasts exist in this category: emit storno deltas for each.
4. Create and persist the new delta.
5. Call `DeltaPropagationService.PropagateDelta` with the new delta — BFS over the derived-state graph, recompute on each edge by its type (Direct/Disassembly/Assembly).
6. Emit `DeltaRegistered` (and `DeltaForecastsStorned` if storno fired).
7. All steps in one transaction.

For complex behaviours (`Split` with recursive propagation, `ActivatePending` with cumulated pendings) a mermaid sequence diagram makes the interaction between PriceState aggregate, SplitPropagationService, and Lock aggregate visible.

### D. Modularisation — 53 BBs in one BC

User comment: *"Modularization is poor. Single Bounded Context is ok but why no internal structure was introduced?"*

The agent read `design-doc-schema.md:111` as forbidding modules absent explicit headings. The natural skeleton sat in the topic graph already. Captured in F3.

Suggested module structure (matches existing topics in the graph):

| Module | Building Blocks | Scope |
|---|---|---|
| `PriceStateCore` | `PriceState`, `Delta`, `DeltaPropagationService`, `Money`, `Quantity`, `CostCategory`, `DeltaFlag`, `DocumentReference`, `BusinessDate`, `AcceptanceTimestamp`, `WarehouseId`, `StockItemId`, `PriceStateId`, `DeltaId`, `PriceStateReference`, events `PriceStateCreated`/`DeltaRegistered`/`DeltaForecastsStorned`, commands `DeltaRegistrationRequested`/`ManualPriceChangeRequested`/`PriceCompletionRequested` | Heart of the model — price state and its deltas |
| `PriceStateSplitting` | `SplitPropagationService`, `PriceStateSplit`, `SplitRequested` | Split propagation — the module's hardest operation |
| `PriceConsumption` | `FifoAllocationService`, `DispatchAccepted`, `PriceStatesConsumed`, `WarehousePolicy` | FIFO and outbound documents |
| `Locking` | `Lock`, `LockActivationService`, `LockId`, `LockStatus`, `SalesOrderReference`, events `LockEstablished`/`LockActivated`/`LockReleased`, commands `LockEstablishmentRequested`/`LockQuantityChangeRequested` | Set-lock, pendings, accumulation |
| `PeriodManagement` | `AccountingPeriod`, `AccountingPeriodId`, `AccountingPeriodStatus`, `AccountingPeriodHistoryEntry`, events `AccountingPeriodClosed`/`AccountingPeriodOpened`, commands `PeriodCloseRequested`/`PeriodOpenRequested`, `DeltaNumberingService` | Closing/opening periods |
| `Reporting` | `PeriodValuationReportService`, `AsOfQuery`, `MonthEndValuationReport`, `AsOfValuationResult` | Reports and historical queries |
| `IncomingDocuments` | `DocumentAccepted`, events from goods-management | Inbound integration boundary |

7 modules × ~7 BBs each — navigable, fits the 3–7-children rule.

### E. Fragments without business meaning (35% noise)

User comment: *"Document fragments are sometimes very small e.g. '**Aktorzy:** Operator (z dedykowanymi uprawnieniami)', '**Scenariusz główny (Happy Path):**'. They are not independent fragments because they bring no business meaning. They are linked with some topics but it's hard to grasp their meaning because they are out of context."*

Captured in F4. Top oversaturated topics:

- `Uprawnienia w module wyceny`: 29 short fragments / 67 (43%)
- `Zamknięcie i otwarcie okresu księgowego`: 28 / 61 (46%)
- `Podział stanu cenowego i propagacja`: 23 / 55 (42%)
- `Delty cenowe i scenariusze zmian`: 22 / 68 (32%)

### F. Fragment reassignment never happened

Step 5 allows reassigning fragments between topics when the mismatch is clear. Because Step 5 was batched (F7), the per-topic critical pass did not run. Many side-mention fragments stayed in their incidental topic. Captured indirectly in F7 + F9.

## Time efficiency observations

These are not correctness issues; they cost time on the run.

1. **Three full-document Reads where one would do.** The 1113-line document was read in 4 chunks (1–100, 100–449, 449–798, 798–1118). One `Read(limit: 1200)` would have been faster and kept the cache hot.
2. **Sequential summary writing for 28 topics.** Per-topic loop is the right shape; the cost was the 250-KB `output.json` round-trips. F7's batch path addresses this.
3. **Linear Design Doc JSON write (57 KB, 53 BBs).** Validation requires one atomic write — splitting it would break reference resolution. Modularisation (F3) shrinks the per-write surface organically.

## Output quality assessment

| Aspect | Verdict | Comment |
|---|---|---|
| Pipeline completion | OK | All 7 steps ran. |
| Topic structure | OK | Goldilocks worked. |
| Topic summaries | OK+ | Bilingual, evidence-based. |
| Topic items granularity | FAIL | 35% noise; F4/F5/F9. |
| Decision extraction | FAIL | 0 new, 0 attached; F6. |
| Design Doc — structure | OK | Schema-conformant, refs resolve. |
| Design Doc — modularisation | FAIL | 53 BBs flat; F3. |
| Design Doc — rule descriptions | FAIL | 68% empty, 15% tautology; F1. |
| Design Doc — behaviour descriptions | WEAK | ~150 chars, no algorithm; F2. |
| Skill compliance | Partial | Step 5 batched; F7. |
| Custom scripts | Mixed | 2 used, 1 wasted; F8. |
| Time efficiency | Mid | Re-read overhead. |
| Output quality for AI coding agent | FAIL | F1 + F2 dominate. |

## Cleanup tasks for `wycena-dokumentow.json` (post-fix)

After the P0/P1/P2 PRs land, re-run the skill against `Dokumentacja_v3.md`. The new quality gates will reject the shallow descriptions; expect to spend an iteration enriching rules and behaviours. Specific cleanups to verify:

1. Re-run with re-extraction enabled — F1/F2 force ≥80-char rules and ≥400-char behaviours.
2. Apply F3 modular grouping — 7 modules per the table above.
3. Re-run Step 3 with the F4/F5 prep changes — noise fragments drop, glossary splits per bullet.
4. Re-run Step 5 in batch mode (F7) and apply the >40-item coherence check (F9) — `Uprawnienia w module wyceny` should drop from 67 to ~15.
5. Re-run Step 3 with the F6 Decision-coverage check — narrative decisions in `Reguły biznesowe / Polityka wyceny`, `Przetwarzanie asynchroniczne`, `Wycena dokumentów rozchodowych`, `Numeracja delt`, `Blokada okresu księgowego` get extracted and ATTACH-ed to existing graph decisions.
