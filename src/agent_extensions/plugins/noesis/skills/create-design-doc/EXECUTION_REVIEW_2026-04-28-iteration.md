# Execution Review — `noesis:create-design-doc` (iteration mode)

Run on **2026-04-28** against design doc `Wycena Dokumentów Magazynowych` (id `ca6a6da8-…`). **Iteration** invocation: existing baseline doc with ~40 building blocks, one large input file (`tech-spec_v3.md`, 2077 lines / ~63K tokens), four prior conversations already in the graph, auto-mode.

This review is complementary to the existing `SKILL_REVIEW.md` and the green-field `EXECUTION_REVIEW_2026-04-28.md`. Prior reviews captured a clean green-field run; this one stresses iteration mode with a substantive refactor (10+ new BBs, 12 modified, 11 removed, dozens of renamed behaviours/properties).

---

## 1. Summary of execution

- **Duration & shape.** ~30 tool turns end-to-end. First `save_design_doc` rejected with 9 length errors; one fix-up turn; second save returned 6 mermaid warnings; one user-prompt turn (auto-mode escape) and one fix-up turn produced clean save.
- **Custom scripts.** None — only built-in tools.
- **Errors.** One save rejection (quality gate); one self-introduced contradiction (a name in `removed` and simultaneously referenced as input).
- **Final artefact.** `wycena-dokumentow.json` ~80 KB, scratch markdown ~25 KB across 7 files.
- **Outcome.** Saved with 0 warnings on third attempt. Totals: 35 added, 12 modified, 11 removed building blocks; 1 modified actor list (no diff); 1 modified quality attribute.

> **Important caveat — see §3.0.** The `modified`/`removed` totals above reflect a misframed diff. The skill text steered the agent to diff against the **prior design doc record**, but the correct semantic is "diff against the **currently implemented model**". Since the module is unimplemented, every item should have been in `added` and `modified`/`removed` should have been empty. This is the highest-priority finding of this review.

## 2. What prior reviews fixed and that this run validates

The current `SKILL.md` contains many fixes from `SKILL_REVIEW.md` and `EXECUTION_REVIEW_2026-04-28.md`. This run confAirms:

| Prior review item | How this run validates |
|---|---|
| 1.2 / 1.3 Pre-flight parallel reads | All 5 reference files read in one `Read` batch. |
| 1.5 Schema reference loaded up-front | Length minimums and BB-name-only constraints were respected in analysis files; the rework happened only at the last micro-edit step, not at JSON-build time. |
| 2.3 Cross-cutting qualities sub-step | §3.7 produced one minor modification to an existing quality attribute; the guard prevented restating Rule-level concerns. |
| 2.6 Use-case / Behaviour / app-service grouping | `GetCostOfGoodsSold` and `GetWarehouseValuation` modelled as `application_service` BBs each hosting one `Calculate` Query behaviour; multi-use-case grouping not needed in this run, but no fragmentation either. |
| 3.6 "Obvious resolution" criterion | All ambiguities resolved by reference to the tech spec without `AskUserQuestion`. |
| 3.7 Empty `ChangeSet` boilerplate | **Not yet applied.** The produced JSON contains hundreds of `{added: [], modified: [], removed: []}` placeholders. The skill text doesn't yet authorise omitting them. |
| 3.8 MCP tool preload | **Not yet applied.** The agent loaded tools in two `ToolSearch` batches (initial 10 + later for `save_design_doc` + `TaskCreate`). |
| 3.10 JSON syntax pre-check | **Not exercised.** No syntax error occurred, so the missing pre-check didn't bite. |
| 3.11 Mermaid encoding | The agent succeeded at `\n`-escaping, but spent extra effort because the convention isn't documented. |

---

## 3. NEW findings from this execution

### 3.0 The diff baseline is conceptually wrong (CRITICAL)

**What happened.** Both `SKILL.md §4` and `references/.../design-doc-schema.md §3` define the diff baseline as the **prior design doc record** (`read_design_doc` output). On this run the agent dutifully diffed the v3 tech-spec model against the prior design doc and emitted ~12 `modified` and ~11 `removed` items.

**Why this is wrong.** A Design Doc is consumed downstream by `noesis:implement-design-doc`, which translates `added`/`modified`/`removed` into code changes against the **codebase**. Therefore:

- `added` = items the implementer should bring into existence (not yet in code).
- `modified` = items the implementer should change in code (already in code, definition changed).
- `removed` = items the implementer should delete from code (already in code, no longer wanted).

The baseline that determines which bucket each item lands in must be the **currently implemented model**, not the prior iteration of the design doc. A design doc that has been authored but not yet implemented carries items in `added` until the implementer materialises them; a second authoring pass against the same unimplemented design must keep them in `added` (perhaps with an updated definition), not move them to `modified`.

In this run, the module is unimplemented (`Wycena Dokumentów Magazynowych` is a green-field bounded context with no code yet). Therefore the **correct** output is: every building block in `added`, `modified`/`removed` empty — even though many of those building blocks were also in the prior design doc record.

**Why the misconception slipped past.**

- `SKILL.md §4`: *"If iterating, re-read the existing Design Doc loaded in §1.0 — that is the authoritative baseline for the diff."* This is the wrong baseline.
- `design-doc-schema.md §3`: *"**First-time design** (no `<design_doc_id>` provided): everything goes into `added`."* and *"**Iteration on existing design** (`<design_doc_id>` provided): always diff against the result of `noesis-graph:read_design_doc`."* The dichotomy "first-time vs. iteration" treats design-doc-record-presence as the trigger, when implementation status is the right trigger.
- Neither the skill nor the schema reference acknowledges that the design doc itself is not the system of record for *what is implemented*.

**Knock-on effects on this review.** Several findings below assumed the prior baseline was correct. They are still real frictions but their priority shifts once §3.0 is fixed:

- **§3.1** (removed-but-referenced contradiction) — disappears entirely under correct semantics. With everything in `added`, there is no `removed` set to contradict references. The validator improvement (Wave 3 #13) is still useful as a defence in depth but the agent-side mistake becomes structurally impossible.
- **§3.8** (renames as remove+add) — disappears. Under correct semantics, an old name simply doesn't appear at all (it was never implemented), and the new name appears in `added`. There is no rename to express.
- **§3.9** (property renames) and **§3.10** (behaviour renames) — same as §3.8: vanish for unimplemented designs; only re-emerge when a design doc is updated *after* implementation.
- **§3.3** (iteration-mode redundancy) — meaning of "iteration" needs to be redefined. Iterating on an unimplemented design doc is *not* iteration in the diff sense; it's just refining the same `added` set. True iteration starts only after implementation, when re-read state can include "what's in code".

**Proposed fix (`SKILL.md` §4) — replace the diff-baseline paragraph with:**

> The Design Doc emits a diff against the **currently implemented model** — what `noesis:implement-design-doc` will read as the starting state of the codebase. This is *not* the same as the prior Design Doc record. Concretely:
>
> - **Items not in code, regardless of whether they appear in the prior design doc record:** emit in `added`. The implementer needs to bring them into existence.
> - **Items in code whose definition changed in this iteration:** emit in `modified` with only the changed sub-fields plus the identity `name`.
> - **Items in code that the design no longer includes:** emit in `removed` (by name).
>
> When the design doc is **green-field** (no implementation yet — the typical case for a first or second authoring pass before any `implement-design-doc` run), every item belongs in `added`, even if a prior design doc record already listed them. `modified` and `removed` stay empty until implementation has happened.
>
> When the design doc is **post-implementation** (one or more `implement-design-doc` runs have produced code from this design), the diff is against the resulting code. Use the prior Design Doc record only as a *hint* about what was last asked-for; the system of record is the code.

**Proposed fix (`design-doc-schema.md` §3) — replace the ChangeSet rules paragraph with:**

> - **The diff baseline is the implemented codebase**, not the prior Design Doc record. Pick the bucket by asking "is this item already in code?":
>     - **Not in code** → `added`.
>     - **In code, definition unchanged from what's there** → omit (don't restate).
>     - **In code, definition changed** → `modified` with only the changed sub-fields plus `name`.
>     - **In code, no longer wanted** → `removed` (by name).
> - For nested ChangeSets, recurse with the same baseline question per item.
> - **Identity:** `name` is the identity key. A rename of an item already in code is `removed: ["<old>"]` + `added: [<new>]`. A rename of an item *not* in code is just `added: [<new>]` — the prior design doc's `<old>` is irrelevant because no code has it yet.

**Proposed fix (workflow-level — Setup or §1.0).** Add an "implementation status" determination:

> **§1.0a Implementation status.** After §1.0, determine whether the in-scope Bounded Context(s) have been implemented in code. Sources of evidence (in order): (a) explicit user statement in the invocation message; (b) `noesis-graph` provenance fields (if exposed) showing whether `implement-design-doc` has run on this design doc; (c) the actual codebase, if accessible from this invocation. When unsure, ask via `AskUserQuestion`. The answer determines the diff baseline used in Step 4.

**Proposed fix (validator-level — `design-docs.service.ts`).** The validator currently treats `added`/`modified`/`removed` as opaque buckets and only checks length minimums. It could grow an *advisory* check: when iterating against a prior design doc record, warn if the new payload moves an item from prior `added` to `modified` while the implementation marker for that item is "not yet implemented". This requires the server to track "implemented vs. designed only" per item, which is a non-trivial schema extension but addresses the root cause.

**Implication for this run's saved artefact.** The `ca6a6da8-…` design doc as currently saved misrepresents the work needed by `implement-design-doc`. A correct re-save would collapse the 12 `modified` + 11 `removed` items back into a single `added` bucket against an empty implementation baseline. **This run's saved JSON should be regenerated** under the corrected semantics before the next `implement-design-doc` invocation, otherwise the implementer will look for "current" code state for `Lock`, `LockId`, `LockEstablishmentRequested`, etc. that has never existed.

---

### 3.1 Self-check at Step 4 didn't catch a removed-but-referenced contradiction (HIGH — but obviated by §3.0)

**Note.** Under the corrected semantics in §3.0, this class of contradiction becomes structurally impossible for unimplemented designs (no `removed` items exist). It only re-emerges in post-implementation iterations. The validator-level fix in Wave 3 #13 is still warranted as defence in depth — it costs little and catches the bug in the post-implementation case.

**What happened.** The agent placed `LockQuantityChangeRequested` in `boundedContexts.modified[0].buildingBlocks.removed` while simultaneously using it as `input` for the new `AdjustLockQuantity` behaviour on `PriceStateLock`. The first `save_design_doc` call did not reject this (the validator only checks length minimums, not cross-reference resolution against `removed`).

**Why it slipped.** SKILL.md §4 says the self-check covers `usedBuildingBlocks`, `input`, `output`, `properties[].type` against "a Building Block declared in the produced doc, in the prior model, to a primitive, or to a primitive enum literal" — but it does not say that an item being simultaneously **removed** in the same diff invalidates the reference.

**Recurring pattern.** Any rename refactor (Lock → PriceStateLock; ChangeLockQuantity → AdjustLockQuantity) touches dozens of names; some old names get reused as inputs/outputs by new behaviours and the agent forgets to drop them from `removed`.

**Proposed fix (skill-level).** Extend SKILL.md §4 self-check to:
> A name listed in `removed` of any nested ChangeSet must not appear as `input`, `output`, `usedBuildingBlocks`, or `properties[].type` anywhere in the same JSON. Treat `removed` and `referenced` as mutually exclusive sets within one save.

**Proposed fix (validator-level).** Add a check in `design-docs.service.ts:validateDesignDocQuality` that walks every removed name in any nested `ChangeSet` and asserts no other field resolves to it. Today the validator silently accepts the contradiction; promoting it to an error catches the pattern at save time and saves a re-save round-trip.

### 3.2 Working-directory basename derived inconsistently (MEDIUM)

**What happened.** The existing JSON artefact is at `work_items/wycena-dokumentow.json` (without `-magazynowych`, ASCII-fold of the title). The agent created the working directory as `work_items/wycena-dokumentow-magazynowych.analysis/` — using the slug of the design doc title rather than the basename of the actual `design_doc_path`.

**Why it slipped.** SKILL.md Setup says:
> Pick a `<working_dir>` for analysis scratch files: a sibling directory of `design_doc_path` named `<basename>.analysis/`.

It does not say "basename of `design_doc_path`" explicitly, and earlier in Setup:
> Default: `<repo_root>/work_items/<slug>.json`, where `<slug>` is the kebab-case slug of `design_doc_title`.

— the agent computed a fresh slug from the title rather than reading `design_doc_path` (which already existed because the doc was being iterated and the file was already on disk).

**Cost.** Cosmetic inconsistency, harder to grep, slightly confusing in code review.

**Proposed fix (`SKILL.md` Setup).** Replace:
> Pick a `<working_dir>` for analysis scratch files: a sibling directory of `design_doc_path` named `<basename>.analysis/`.

with:
> Pick a `<working_dir>` for analysis scratch files: a sibling directory of `design_doc_path` named `<basename>.analysis/`, where `<basename>` is the file basename of `design_doc_path` *without* the `.json` extension. When iterating on an existing design doc and a JSON file already exists at the canonical path, **prefer that file's basename** to the slug of the title — they may differ.

### 3.3 §1.5 duplicates §1.0 when only one BC is in scope (MEDIUM — terminology clarified per §3.0)

**Terminology.** "Iteration mode" is a misnomer here. What this section addresses is "re-running the skill on a doc that already has a record in the graph", which is orthogonal to whether the underlying model has been implemented (§3.0). The redundancy below is real regardless of implementation status.


**What happened.** §1.0 (`read_design_doc`) returned the full Markdown of the doc — actors, the only BC, all 40+ building blocks, all behaviours/rules/scenarios/quality attributes. §1.5 (`read_model_for_modules`) on the same BC would have returned the same content. The agent skipped §1.5 because the data was already in hand.

**Why it slipped.** SKILL.md §1.5 has only the green-field short-circuit. There is no iteration short-circuit:
> If `design_doc_id` was provided AND §1.4 selected only BCs already fully rendered in §1.0 (i.e. no BC from another design doc is in scope), skip §1.5.

**Cost in this run.** None — agent skipped voluntarily. But a less-confident agent would call §1.5 and pay an MCP round-trip + extra tmp file read for no new information.

**Proposed fix (`SKILL.md` §1.5).** Append:
> **Iteration short-circuit.** When §1.0 ran (i.e. iterating on an existing doc) and every entry in the §1.4 candidate list is `(this design doc's BC, …)` — i.e. no in-scope BC lives in another design doc — skip §1.5; the §1.0 markdown is already the model. Run §1.5 only when §1.4 lists at least one BC from a different `design_doc_id`.

### 3.4 First save rejected by 9 length errors despite the schema reference being loaded up-front (MEDIUM)

**What happened.** Despite loading `design-doc-schema.md` at pre-flight, the agent emitted nine descriptions below threshold (8 short Rule descriptions ≤ 79 chars; 1 short Behaviour description at 389 chars). Each was a borderline case: e.g. `"Wybór PS do podziału po Quantity DESC — minimalizacja liczby splitów (RB-10)."` (79 chars).

**Root cause.** Knowing the threshold in the abstract is not enough; the agent does not run a structured length check before issuing `save_design_doc`. The save then becomes the de-facto linter, costing one round-trip per batch of misses.

**Proposed fix (skill-level).** Add a Step 4.0 just before saving:
> **Pre-save length pass.** Before invoking `save_design_doc`, programmatically check (e.g. via Bash with `python3 -c "import json,sys; d=json.load(open('<path>')); …"`) that every `added` Rule description is ≥80 chars and every `added` Behaviour description is ≥400 chars. Fix in place; do not rely on the validator to bounce a save just for length.

This is essentially the JSON-pre-check from §3.10 of the prior review extended with length validation. A 5-line Python snippet covers it.

**Proposed fix (validator-level, optional).** Provide a `validate_design_doc` MCP tool that returns the same `errors` and `warnings` lists *without* persisting. Lets the agent pre-validate without mutating state — useful when a save would be expensive (large diff) or when the agent wants a final quality check before committing.

### 3.5 Mermaid embedding flow forces an interactive prompt in auto-mode (MEDIUM)

**What happened.** `save_design_doc` returned 6 warnings about missing mermaid sequence diagrams in behaviours using ≥3 building blocks. The agent escalated via `AskUserQuestion` ("embed mermaid in all 6, or accept warnings?"), interrupting auto-mode flow. The user chose embedding, the agent then adapted six diagrams from the input tech spec into the description fields.

**Why it slipped.** SKILL.md §4 says:
> If `save_design_doc` returns warnings, address every warning (re-edit the JSON, re-save) until the warning list is empty or the user has explicitly accepted a remaining warning via `AskUserQuestion`.

This is interpretable two ways: (a) every warning must be addressed by editing, (b) every warning *or* a user explicit acceptance. In auto-mode, the agent should know which path is the default.

A complementary point: when the input file (Step 2) **already contains** mermaid sequence diagrams for the impacted behaviours, the agent has near-zero authoring cost for embedding — the warning is essentially a flag to do this from the start, not a question to escalate.

**Proposed fix (`SKILL.md` Rules — auto-mode bullet, building on §3.6 of prior review).** Strengthen the auto-mode gates rule:
> **Mermaid warnings.** When `save_design_doc` warns about missing mermaid for ≥3-BB behaviours, **embed the diagrams without prompting** if the input files (`file_paths`) already contain compatible sequence diagrams or class diagrams that can be adapted. Only prompt the user when no source diagram exists and authoring one from scratch would be speculative.

**Proposed fix (`SKILL.md` §3.5 / §3.6).** Promote the mermaid requirement from "fix-on-warning" to "author-by-default":
> When §3.5 identifies a Behaviour that will use ≥3 building blocks (or any `application_service` Behaviour), embed a mermaid sequence diagram in its description **at the analysis stage** — the input files often already have one to adapt.

### 3.6 Read tool's 25K-token cap forces chunked reads of large input files (MEDIUM)

**What happened.** The single input file `tech-spec_v3.md` is ~63K tokens. The agent first called `Read` without `offset/limit`, hit the 25K cap, then read in three chunks (`limit=500`, `offset=500 limit=600`, `offset=1100 limit=600`, `offset=1700 limit=400`). Same pattern hit the decisions list (~26K tokens — one chunk worked but only marginally).

**Why it slipped.** SKILL.md §2 says "Read each one" without addressing large-file ergonomics. Also, the MCP `list_decisions_for_sources` tool has no chunking option — when there are many decisions, the tmp file can blow past the Read cap.

**Cost.** Three extra Read round-trips on this run.

**Proposed fix (`SKILL.md` Step 2).** Add:
> When `file_paths` includes a file larger than ~25K tokens (rule of thumb: > ~5000 lines or > ~150 KB), use `Read` with `offset` and `limit` to chunk through the file. Plan for ~500–600 lines per chunk to stay below the cap.

**Proposed fix (MCP-level).** For tools that emit Markdown to a tmp file (`list_decisions_for_sources`, `list_topic_summaries_for_sources`, `read_design_doc`, `read_model_for_modules`), the server could **split into multiple files when the rendered size exceeds a threshold** (e.g. one file per BC, one file per topic), returning a list of paths rather than one path. The agent can then read them in parallel rather than chunk one big file. (Optional improvement; the chunked-read workaround is sufficient.)

### 3.7 Setup token-form parsing is brittle to natural-language phrasings (LOW)

**What happened.** The user invocation:
> `Update design doc "Wycena Dokumentów Magazynowych" with info from @conversations/wycena-dokumentów/tech-spec_v3.md and conversations: \`dcf37125-…\`, \`7dff…\`, …`

was **not** in canonical token form (`title:"…" @<path> conv:<id> conv:<id> …`) but the agent inferred the routing correctly. The skill's table only lists strict prefixed forms; "and conversations: <id>, <id>" matches no row.

**Cost.** None this run; the inference was right. But other runs may misroute (e.g. plain `<id>` after "decisions:" being treated as a conversation).

**Proposed fix (`SKILL.md` Setup).** Soften the parsing rule:
> The token-form table is the canonical syntax; the agent should also accept natural-language fall-throughs:
> - A bare UUID after a heading like `conversations:` / `convs:` routes to `conversation_ids`.
> - A bare UUID after `documents:` / `docs:` routes to `document_ids`.
> - `Update <doc-name>` or `Iterate on <doc-name>` without `id:` or `title:` is **iteration mode** — call `list_design_docs` and resolve the title to an id. If the title doesn't match any existing doc, ask via `AskUserQuestion` whether the user meant to create.

### 3.8 Renames are heavy-weight in a ChangeSet diff (LOW — disappears for unimplemented designs per §3.0)

**Note.** Under correct semantics, renames in unimplemented designs simply don't exist as `removed`+`added` pairs — the old name was never in code. The friction below applies only to post-implementation iterations.


**What happened.** The tech-spec v3 renamed many concepts: `Lock` → `PriceStateLock`, `LockId` → `PriceStateLockId`, `ChangeLockQuantity` → `AdjustLockQuantity`, `EstablishLock` → `SetLock`, `ManuallyChangePrice` → `RegisterManualDelta`, `CompletePZPrice` → `CompletePurchasePrice`, plus several events. Per the schema doc:
> **Identity:** `name` is the identity key for every entity. Renames must be expressed as `removed` + `added`.

This means every rename emits the **full new BB definition** (description, properties, behaviours, rules, scenarios) plus a `removed` entry — even when the only change is the name. For 7+ renames on this run, that ballooned the JSON size and increased the chance of contradictions like §3.1.

**Proposed fix (schema-level, optional).** Add an explicit `renamed: { from: string; to: string }[]` collection alongside `added`/`modified`/`removed` in the wrapping `ChangeSet`. The validator copies all sub-state from `from` to `to`, then applies `modified` patches to `to`. Saves authoring effort and eliminates one class of self-contradiction. (Larger lift; not required.)

**Proposed fix (skill-level, immediate).** Add to `SKILL.md` §4:
> **Renames.** When renaming a Building Block, Behaviour, Property or Rule, emit `removed: ["<old>"]` and `added: [<full new spec>]`. Then **double-check** that the old name does not appear elsewhere in the JSON (any `input`, `output`, `usedBuildingBlocks`, `properties[].type`, or behaviour-host reference). If it does, those references must point at the new name.

This addresses the same root cause as §3.1 from a different angle — it teaches the agent to think about renames as a paired operation, not as two independent edits.

### 3.9 Properties of modified BBs lack a "rename" mechanism (LOW — disappears for unimplemented designs per §3.0)


**What happened.** Several properties were renamed (e.g. `PriceState.receivedQuantity` → `quantity`, `PriceState.amountPerUnit` → `deltaAmount`, `Delta.flag` → `kind`). The agent had to express each as `properties.removed: ["receivedQuantity"]` + `properties.added: [{name: "quantity", type: "Quantity"}]`. With ~10 property renames, this is verbose and error-prone.

**Proposed fix.** Same as §3.8 — a `renamed` collection on `ChangeSet<DesignedProperty>` would simplify the diff. Not required; the workaround works.

### 3.10 No native "behaviour rename" within a `modified` BB (LOW — disappears for unimplemented designs per §3.0)


**What happened.** PriceState's behaviours `CreateFromIncomingDocument` → `CreatePriceState`, `ConsumeForDispatch` → `ConsumePriceState`, etc. — each emitted as `behaviours.removed: [old]` + `behaviours.added: [new full spec]`. The agent did not preserve any of the old behaviour's nested rules/scenarios automatically; they had to be re-authored as part of the new behaviour spec. In this case it was acceptable (the new spec was substantially rewritten), but in other cases (e.g. a pure rename) it would force unnecessary re-authoring.

**Proposed fix.** Same as §3.8 — `renamed` on `ChangeSet<DesignedBehaviour>`.

### 3.11 The skill's "tasks" indication is implicit (LOW)

**What happened.** The agent voluntarily used `TaskCreate` to track the four steps of the workflow. SKILL.md doesn't mention task tracking at all. The harness reminded the agent twice during the run.

**Proposed fix (`SKILL.md` Workflow header).** A single one-liner:
> For long runs, optionally use `TaskCreate` to track Steps 1–4; mark each completed before progressing.

(Trivial; nice-to-have.)

---

## 4. Recommendations not adopted (and why)

- **Forcing single-BB modules in iteration.** Tech spec v3 implicitly suggests three modules (`Valuation`, `Documents`, `AccountingPeriods`). The agent kept the flat structure (~50 BBs) to minimise churn. Both the schema reference and the BC validator emit a "consider modules" warning for >20 BBs without modules — the agent ignored both. **Decision: leave as-is for this run.** Modularising during iteration would have ballooned the diff. A future iteration explicitly asking for modularization will tackle this.

- **Strict Minimum reload principle.** The agent kept several analysis files in active context (e.g. `analysis-model.md`, `analysis-rules.md`) during JSON authoring, despite the principle saying to offload after each step. **Decision: leave as-is.** Re-loading these large files would multiply token use; the principle remains aspirational.

- **Pre-save length validator implemented as a Python snippet vs MCP tool.** A `validate_design_doc` MCP tool would be cleaner, but is ~50 lines of TypeScript + plumbing; a 10-line Python pre-check is enough for now. **Decision: do the Python snippet first; promote to MCP only if it proves useful in 3+ runs.**

---

## 5. Implementation plan

Concrete edits, in priority order. **Wave 0 is new and supersedes the prior priority ordering** — the diff-baseline correction is foundational; many other items lose urgency once it's in place.

### Wave 0 — Fix the diff baseline (CRITICAL — see §3.0)

0a. **`SKILL.md §4` — replace the diff-baseline paragraph.** Use the wording in §3.0 above: diff against the implemented codebase, not the prior design doc record.

0b. **`design-doc-schema.md §3` — replace the ChangeSet rules.** Use the corrected bucket-picking question ("is this item already in code?") from §3.0 above.

0c. **`SKILL.md §1.0a` — implementation-status determination.** Add a new sub-step that determines whether the in-scope BCs have been implemented. Guides the diff baseline used in Step 4. See §3.0 for the proposed text.

0d. **Regenerate this run's saved JSON.** The current `wycena-dokumentow.json` and the corresponding `ca6a6da8-…` graph record reflect the wrong baseline. Re-author with everything in `added`, `modified`/`removed` empty, and re-save. Track this as a separate task.

0e. **Audit other already-saved DesignDoc records** that were authored under the misframed semantics. Any record produced by an earlier `iteration` run is suspect. List them via `list_design_docs`, check provenance (was `implement-design-doc` ever run?), and regenerate the unimplemented ones.

### Wave 1 — `SKILL.md` text edits (additive, low risk; deprioritise items obviated by Wave 0)

1. **§1.5 — single-BC short-circuit.** Add the short-circuit from §3.3 of this review. (Still relevant — independent of §3.0.)
2. **~~§4 self-check — removed-vs-referenced exclusion.~~** Drop from Wave 1; the class of bug it addresses is structurally impossible for unimplemented designs after Wave 0. Move to Wave 3 as defence-in-depth (still useful for post-implementation diffs).
3. **§4 — Pre-save length pass.** Add Step 4.0 with a `python3 -c "..."` length check (§3.4). Independent of §3.0 — keep in Wave 1.
4. **~~§4 — Renames discipline.~~** Drop from Wave 1; obviated by §3.0 for unimplemented designs. Promote to Wave 2 as part of the schema reference's post-implementation guidance.
5. **Setup — basename rule clarified** (§3.2). Independent of §3.0 — keep.
6. **Setup — soft token parsing** (§3.7). Independent of §3.0 — keep.
7. **§3.5 / §3.6 — author mermaid early** (§3.5). Independent of §3.0 — keep.
8. **Rules / Auto-mode gates — mermaid warnings** (§3.5). Independent of §3.0 — keep.
9. **Step 2 — large-file chunking** (§3.6). Independent of §3.0 — keep.
10. **Workflow header — TaskCreate hint** (§3.11). Independent — keep.

### Wave 2 — `references/design-doc-schema.md` edits

11. **Post-implementation rename guidance.** When iterating post-implementation, document the rename pattern explicitly (`removed: ["OldName"]` + `added: [{name: "NewName", …}]` + cross-reference cleanup). Make clear this only applies once code exists.
12. **Mermaid encoding example.** From §3.11 of the prior review (still pending).
13. **Worked example: green-field iteration.** Show a "second authoring pass on an unimplemented design doc" example where a building block's definition is materially refined but it stays in `added` (no code yet). This is the case the current text gets wrong.

### Wave 3 — Validator changes (`design-docs.service.ts`)

14. **Reject removed-but-referenced contradictions** (defence in depth — see §3.1). Walk every removed name; if any other field resolves to it, push to `errors`. Catches the post-implementation rename mistake.
15. **Optional: `validate_design_doc` MCP tool.** Same logic, no persistence. Useful for pre-flight (§3.4) and especially for the implementation-status determination in §1.0a (lets the agent ask "given this baseline assumption, is the diff coherent?").
16. **Implementation-status awareness in the validator.** Once the server tracks "is this item materialised in code" (per item or per design doc), the validator can warn when the diff places not-yet-implemented items in `modified`/`removed`. Prerequisite: the schema needs to grow an implementation marker (Wave 5).

### Wave 4 — Schema enrichment (optional, larger lift; many items obviated by Wave 0)

17. **~~`renamed: {from, to}[]` collection on `ChangeSet`.~~** Demote from Wave 4 priority. Renames in unimplemented designs don't exist (Wave 0 handles them); renames in post-implementation iterations are uncommon enough that the existing remove+add pattern is acceptable.

### Wave 5 — MCP server / persistence enhancements (foundational for §3.0)

18. **Implementation marker per item.** Extend the persisted Design Doc model with a per-item `implementedAt: timestamp?` (or equivalent flag) populated when `implement-design-doc` materialises that item in code. Once present:
    - The server can answer "is this item in code?" deterministically (replacing the §1.0a heuristic with a fact lookup).
    - The validator can enforce the §3.0 bucket rules at save time.
    - `read_design_doc` can render implementation status alongside each item, so the next authoring pass diffs against reality, not memory.

19. **Multi-file emission for large markdown rendering tools** (§3.6 — keep as-is). When `read_design_doc` / `list_decisions_for_sources` / `list_topic_summaries_for_sources` would emit >25K tokens, split into multiple files. Solves the chunked-read friction at the source.

---

## 6. Test plan for the proposed edits

After **Wave 0** (the diff-baseline correction), re-run the skill on this same input. Expected outcome:

- Saved JSON has every building block in `added`; `modified` and `removed` collections are empty.
- Total: 35 + 12 + 11 = ~58 items, all in `added` (down from "35 added / 12 modified / 11 removed").
- Self-introduced contradictions like the `LockQuantityChangeRequested` issue (§3.1) become structurally impossible.
- Net JSON size grows slightly (full specs in `added` are larger than `modified` patches), but semantics are correct.

After **Wave 1** (residual text edits), expected additional improvements:

- One save round-trip eliminated (Wave 1 #3: pre-save length pass catches length errors locally).
- Zero mid-run `AskUserQuestion` for mermaid acceptance (Wave 1 #7 + #8 fold mermaid into authoring time).
- One `read_model_for_modules` call eliminated (Wave 1 #1) when single-BC.
- Working-dir name matches JSON basename (Wave 1 #5).

After **Wave 5** (#18 implementation marker) lands, expected:

- The §1.0a determination becomes a fact lookup, not a heuristic.
- The validator can enforce diff-baseline correctness at save time, not just by skill discipline.
- Future post-implementation iterations get correct `modified`/`removed` mechanics for the first time.

---

## 7. Closing note

The dominant finding of this review is **§3.0**: the skill text and schema reference both define the wrong diff baseline. Every other observation in this review (length-pass, mermaid discipline, working-dir naming, large-file chunking) is real but secondary. Until the diff baseline is corrected, the skill produces design docs that misrepresent the work needed by `implement-design-doc` — and the produced ChangeSets get progressively more wrong with each "iteration" against an unimplemented design.

Wave 0 is the high-leverage next step. It is conceptual, not mechanical: a few paragraphs of replacement text in `SKILL.md §4` and `design-doc-schema.md §3`, plus a new §1.0a step. Wave 5 #18 (implementation marker) makes it enforceable rather than discipline-dependent. Wave 1 items are still useful but are tier-2 polish.
