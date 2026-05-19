# Diff handling analysis — `noesis:create-design-doc`

Date: 2026-05-11
Scope: end-to-end review of how a Design Doc's `added` / `modified` / `removed` slots are produced by the skill, persisted by `save_design_doc`, projected into the graph DB, and re-surfaced on the next authoring pass. No code changes — findings only.

## 0. Reference model

Per the user's clarifications, the intended invariants are:

1. A Design Doc is a **diff** between the **currently implemented model** (= what is actually in the C# codebase right now, regardless of how it got there) and the **new requirements** (conversations, documents, files, invocation text).
2. A subsequent Design Doc is a diff between the **post-implementation state of the prior doc** and the next batch of requirements — but that state still comes from the **codebase**, not from aggregating prior design-doc diffs. Manual edits to the codebase (commits not produced by `implement-design-doc`) are part of the implemented model and must be reflected.
3. The skill must check the **actual model** (= what the **scanner** reports about the codebase: Bounded Contexts, Modules, Building Blocks, Behaviors) at the start. The MCP server already exposes this via `get_domain_model` (`scanner.mcp.ts:12`). **Prior design docs are not the source of truth.** When creating a new Design Doc the skill must **not** consult prior Design Docs to derive the baseline.
4. **Cascading-modified rule.** When an element changes — *including any descendant change* (e.g. a new Rule inside an existing Behaviour) — every ancestor up to the Bounded Context must appear in its parent's `modified` slot with only the changed sub-fields plus the identity `name`.
5. Only changed elements appear in any given Design Doc; unchanged elements are omitted (they remain materialised in the codebase).

Findings below evaluate the skill+server against these invariants.

---

## 1. Critical bugs

### 1.1 The baseline-discovery pipeline (§1.0a → §1.3 → §1.4 → §1.5) is built on the wrong source

SKILL.md Step 1 instructs the agent to derive the diff baseline from prior Design Docs:

- §1.0 reads `read_design_doc` for the iterated doc.
- §1.0a admits the codebase is the system of record but offers three weak evidence sources ("user statement", "noesis-graph provenance fields, when exposed", "the codebase, when accessible").
- §1.3 reads `read_bounded_context_map` — a list aggregated from every prior Design Doc's `boundedContexts.added`.
- §1.4 picks `(bounded_context_name, module_path?, design_doc_id)` triples *attributed to prior docs*.
- §1.5 calls `read_model_for_modules` against those design_doc_ids.

This is wrong by design per invariant (3): the implemented model comes from the **scanner**, not from prior diffs. Manual commits to the codebase are invisible to a design-doc aggregation, so even a perfectly-correct aggregation pipeline would produce a stale baseline whenever someone hand-edits a class.

The fix is structural: §1.3 / §1.4 / §1.5 should be replaced by a **single call** to `noesis-graph:get_domain_model` (already implemented in `scanner.mcp.ts`). The returned tree is the diff baseline for Step 4. §1.0a's three evidence options disappear — there is only one canonical source.

`read_bounded_context_map`, `read_model_for_modules`, and `list_design_docs` are still useful for *administrative* purposes (the user asks "list my docs", "show doc X"), but they have no role in baseline computation for a new or subsequent doc.

### 1.2 SKILL.md explicitly forbids what it implicitly requires

Two passages collide:

- §1.0a invokes prior-design-doc evidence and §1.3-§1.5 walks the prior-design-doc tree.
- Step 4: *"The diff baseline is the currently implemented codebase as a whole — not the prior Design Doc record (§1.0)"*.

If the codebase is the baseline, the entire §1.3-§1.5 chain is dead weight. If it is alive, Step 4's claim is false. Currently both are present, and the agent has to reconcile them — typically by reading prior docs anyway, because that is where the data is mechanically available.

This needs to collapse to one rule: **scan the codebase; do not aggregate prior diffs.**

### 1.3 `read_design_doc` renders only the `added` slot

`formatDesignDoc` (`design-docs.mcp.ts:386`) recurses into `boundedContexts.added` and at every nesting level only into `*.added`. The `modified` and `removed` content of the doc — and the `removed_*_names` STRING[] columns the graph DB stores — never appear in the rendered Markdown.

This matters in exactly one place: **iteration on an unimplemented "subsequent" doc.** That doc may already carry `modified` / `removed` entries (because it was authored against an earlier implemented baseline). When the agent re-opens it via `read_design_doc`, those entries are invisible, so the next save will silently drop them.

(Iteration on a green-field doc with only `added` content is unaffected. Once a doc is implemented, `prepareDesignDocPath` rejects further iteration, so the gap closes itself.)

This is independent of §1.1 — even after the baseline source is fixed, the renderer must surface all three slots for the iteration-after-modify case.

### 1.4 The graph DB has the model but no one reads it like a model

The repository projects every Design Doc into a rich graph (`design-docs.repository.ts:127-155`): `DESIGNDOC_HAS_ADDED_BOUNDED_CONTEXT` / `DESIGNDOC_HAS_MODIFIED_BOUNDED_CONTEXT`, `BUILDING_BLOCK_HAS_ADDED_BEHAVIOUR`, etc., with `removed_*_names` arrays for delete slots. The data is there. But the read side (`readModelForTargets`, `readBoundedContextMap`, `formatDesignDoc`) only consults `boundedContexts.added` of a single design-doc JSON file — bypassing the graph entirely.

Per invariant (3), that graph should not be aggregated into a "model view" anyway: the scanner is. So the right fix is **not** to add a "consolidated implemented model" reader on top of design-doc diffs. The graph stays useful as an *index of doc history* (queries like "which docs mentioned this BC?", "show me the latest design intent for behaviour X"), and `get_domain_model` remains the only baseline source.

### 1.5 Cascading-modified rule is implicit only

The user's invariant (4) — *any descendant change forces every ancestor into `modified` with only the identity `name` and the changed sub-fields* — is **not stated** in SKILL.md or `design-doc-schema.md`. The schema doc gives one micro-example (§3: "A `modified` building block whose only change is a new property emits `{ name: '...', properties: { added: [{name, type}] } }`") but never spells out the cascade up to the BC.

Dev-seed `tierExpansionDesignDoc` shows the correct shape (Sales BC `modified` → Pricing module `modified` → PriceCalculator BB `modified` → properties `added`), so the data model assumes the cascade, but a reader of the skill cannot infer it. A new run will plausibly emit one of these wrong shapes:

- Putting the new rule under `boundedContexts.added[BC1].buildingBlocks.added[BB1].behaviours.added[BH1].rules.added[…]` (because the agent only "added a new rule"), re-adding the BC and clashing with the scanner-reported BC1.
- Putting the new rule under `boundedContexts.modified[BC1].buildingBlocks.modified[BB1].behaviours.modified[BH1].rules.added[…]` while omitting the module ancestor — losing the module link.

There is no validator either: `save_design_doc` accepts any shape that parses against the Zod schema, so neither of the above produces an error.

### 1.6 `save_design_doc` is described as the "ultimate validation" but performs almost no validation

SKILL.md Step 4.1: *"Save is the ultimate validation. … Schema constraints (description length minimums, reference resolution, `removed`-vs-referenced contradictions, `implements` targets, etc.) are enforced by `save_design_doc` and returned as structured errors."*

Actual implementation (`design-docs.service.ts:saveFromFile` → `persistFromWorkingFile` → `persistFile` → `repository.writeFile`):

- Validates the Zod parse (`DesignDocFileNewSchema.parse`).
- Detects locked-field conflicts on top-level `name` / `description`.
- Writes the file. Returns `{ status: "Ok", warnings: [] }`.

It does **not** check:

- Description length minimums for `added` Behaviour / Rule / QA bodies.
- Reference resolution for `input` / `output` / `usedBuildingBlocks` / `properties[].type` / `implements`. With invariant (3) in mind, the resolution targets should be: BBs declared in this doc (in `added` or `modified`) **or** BBs returned by `get_domain_model` for the relevant scope.
- `removed: ["X"]` co-existing with a reference to `X` elsewhere in the doc.
- A `modified` ancestor whose identity name does not match any element returned by the scanner. (Without this, the agent can `modify` a phantom BC.)
- The cascading-modified rule: every ChangeSet listing a child must have its ancestor present in the parent's `modified` slot.
- `behaviour.actor` set on a non-`application_service` host (schema doc explicitly says save rejects this — it does not).
- `behaviour.actor` resolving to a name in the global Actor catalog (schema doc says save rejects this — it does not).
- Mermaid presence / well-formedness warnings.
- BC has >20 BBs and 0 modules warning.
- QA duplicated across levels (schema doc says save rejects — it does not).

`warnings: []` is hardcoded. None of the rules documented in the schema doc are evaluated. The skill's fix-and-retry loop has nothing to react to.

### 1.7 `behaviour.actor` is stored but rarely linked as a graph edge

`upsertBehaviour` (`design-docs.repository.ts:750`) creates the `BEHAVIOUR_PERFORMED_BY_ACTOR` edge only when the actor name appears in the doc's `file.actors[]` array (`declaredActorNames.has(bh.actor)`). But:

- The schema doc and SKILL.md explicitly tell the agent **not** to populate `file.actors`; actors are graph-global, managed via `upsert_actor`.
- The dev-seed populates `file.actors`, which is why the edge exists for seeded docs. Skill-produced docs leave `file.actors` empty.

Result: for every skill-driven Design Doc, the `BEHAVIOUR_PERFORMED_BY_ACTOR` edge is **never created**. The `actor` field is kept as a scalar on the DesignedBehaviour node and the graph-global `Actor` node exists, but they are unconnected. This contradicts the plugin's "Graph model" rule in `noesis/CLAUDE.md`: *"Every cross-entity reference between node types MUST be modelled as a `CREATE REL TABLE` edge — never as a scalar foreign-key column on the node."*

Two contradictions in one place:

- `DesignDocFileNew.actors` still exists in the Zod schema (`design-doc-new.ts:206`) but the spec says it should not. Either the schema field is dead code that should be removed, or the skill's instructions are wrong.
- The edge-creation predicate in `upsertBehaviour` should match against the graph-global actor catalog, not the in-doc list.

---

## 2. Documentation / process gaps

### 2.1 The skill workflow should be rewritten around the scanner

Step 1 currently has six sub-steps for baseline collection. Under invariant (3) it should be:

- §1.0 (iteration only): read the prior version of *this* doc via `read_design_doc` — but only to recover the agent's prior authoring intent, never as the diff baseline.
- §1.A (new sub-step): call `noesis-graph:get_domain_model` to obtain the actual implemented model tree. Save it to `<working_dir>/baseline-model.md` (or `.json`). This is the diff baseline for Step 4. It includes manual edits to code that no design doc captured.
- §1.1 / §1.2: topic summaries and decisions, unchanged.
- §1.3 / §1.4 / §1.5: **delete**. They aggregate prior design-doc diffs, which is the wrong source.
- §1.0a: **delete** the "is this in code?" evidence chain entirely; the question is now mechanical against `baseline-model.md`.

Step 4 bucketing then becomes a clean structural compare: for every element in the requirements, look it up in `baseline-model.md`. Present → `modified` (with only the changed sub-fields). Absent → `added`. Present in baseline but absent from requirements *and* explicitly retired by the user → `removed`.

### 2.2 SKILL.md never spells out the cascading-modified rule

Add an explicit subsection to Step 4 (or `design-doc-schema.md` §3):

> A change at depth N forces a `modified` entry at every ancestor 1..N-1. The ancestor entry carries only:
> - `name` (identity, copied verbatim from the scanner output),
> - the single child ChangeSet slot containing the descendant change (e.g. `modules`, `buildingBlocks`, `behaviours`, `properties`, `rules`, `scenarios`, `qualityAttributes`),
> - no other fields, and no `description` override unless the ancestor's description itself changed.

Without this, the agent has to reverse-engineer the cascade from the dev-seed example, which the skill never tells it to read.

### 2.3 "Subsequent Design Doc" vs "iteration" are not separated

The skill's Setup section conflates two regimes:

- **Iteration on an unimplemented doc** (`design_doc_id` supplied, doc not yet sealed): the file is overwritten. The agent re-emits the full prior diff plus the new changes. Diff baseline is still the scanner's tree (per invariant 3) — *not* whatever the prior iteration of this doc tried to add. The previous iteration's `added` slot is just a hint about authoring intent; if the scanner shows BB1 already in code, BB1 is in code regardless of what an unimplemented prior iteration claimed.
- **New / subsequent doc** (`design_doc_title` supplied, new doc, prior doc(s) sealed or absent): the file is brand-new. Diff baseline is the scanner's tree. No prior design doc is consulted.

The most error-prone case — *iteration of a "subsequent" doc that already contains `modified` / `removed` slots* — is not called out and is the case that is broken by §1.3 (the renderer omits the slots the agent needs to recover its own prior intent). Worth a dedicated subsection.

### 2.4 `read_design_doc` description over-promises

In SKILL.md §1.0 the tool is described as: *"a Markdown rendering of the full current state (bounded contexts → modules → building blocks → behaviours, with rules, scenarios, and quality attributes nested at the level they apply)"*. After §1.3, this is true only for `added` content. And after invariant (3), the phrasing "full current state" is misleading even when fixed — the tool returns this doc's diff, not the implemented model. SKILL.md should say: *"the Markdown rendering of this doc's diff (added / modified / removed at every level), used as a hint about what was previously asked-for on this doc only — never as the diff baseline"*.

### 2.5 Drop the `design_doc_id` from baseline-related calls

`read_model_for_modules` takes `(design_doc_id, bounded_context_name, module_name?)` tuples and §1.4 of the skill instructs the agent to assemble them by guessing which prior doc "owns" a BC. Under invariant (3) the question is meaningless: the BC's structure is whatever the scanner reports. Either keep the tool for administrative use only (e.g., "show me how Sales looked in doc X") and remove it from the baseline workflow, or delete it.

---

## 3. Optimisation opportunities

### 3.1 Hook the scanner into the skill (replaces my earlier "read_implemented_model" idea)

The scanner already exists: `get_domain_model` in `scanner.mcp.ts`. The fix is to make the skill use it — not to add a new aggregator over prior design docs (which was my prior recommendation and is wrong per invariant 3).

Concretely:

- Add `mcp__plugin_noesis_noesis-graph__get_domain_model` to the SKILL.md "MCP tool preload" list.
- Add a §1.A sub-step that calls it once and writes the result to `<working_dir>/baseline-model.md`.
- Reference `baseline-model.md` from Step 4 ("bucket every element by structural lookup against `baseline-model.md`").

Net effect: invariant (3) becomes mechanically enforced. Manual code edits flow into the baseline automatically.

### 3.2 Render all three slots in `read_design_doc`

`formatDesignDoc` (and its helpers `appendBoundedContexts`, `appendModule`, `appendBuildingBlock`, `appendBehaviour`, `appendQualityAttributes`) must walk `added`, `modified`, and `removed`. Suggested rendering: a marker prefix per line — `[+]` / `[~]` / `[-]` — to scale to deep trees and stay agent-parseable. Surface `removed_*_names` arrays under their parent as `[-] Name` entries.

Effect: iteration on an unimplemented "subsequent" doc no longer loses prior modify/remove intent.

This is independent of the scanner-based baseline; both fixes are needed.

### 3.3 Implement the validations promised in SKILL.md Step 4.1

In `saveFromFile`, before persisting, run a validation pass that returns structured errors and warnings. With the scanner-baseline model in mind, the rules become:

- Description length minimums on `added` Behaviour / Rule / QA bodies.
- Reference resolution for `input` / `output` / `usedBuildingBlocks` / `properties[].type` / `implements`, against (a) in-doc declarations and (b) elements the scanner reports for the relevant scope.
- Every `modified` entry's identity `name` must match an element the scanner reports in the same parent. Otherwise the agent is "modifying" a phantom.
- Cascade integrity (every ChangeSet listing a child must have its ancestor present in the parent's `modified` slot).
- `removed: [X]` co-existing with any reference to `X` is a hard error.
- `removed: [X]` where the scanner does not report X is a hard error (cannot remove what is not there).
- `behaviour.actor` set on a non-`application_service` host is a hard error.
- `behaviour.actor` not in the global actor catalog is a hard error.
- Mermaid block required on Behaviours that host an `application_service` or use ≥3 BBs (warning only).
- BC with >20 BBs and 0 modules (warning).

Currently `warnings: []` is hardcoded; the skill's fix-and-retry loop has nothing to react to.

### 3.4 Stop materialising `DesignDocFileNew.actors` and the linked-only-when-declared rule

Either:

- Remove `DesignDocFileNew.actors` (drop the Zod field, remove from dev-seed) and link `BEHAVIOUR_PERFORMED_BY_ACTOR` whenever `behaviour.actor` resolves against the global actor catalog. This matches the SKILL.md instruction and the plugin's graph rule.
- Or keep `file.actors` but document it clearly and align the SKILL.md / schema doc.

Pick one; current state is contradictory.

### 3.5 Demote `read_bounded_context_map` / `read_model_for_modules` / `list_design_docs` to administrative tools

They are useful for UI / history queries but should not be advertised by SKILL.md as baseline sources. Update their tool descriptions to make this explicit, and remove their preload from create-design-doc's "MCP tool preload" list.

### 3.6 Title fallback collision should be a hard prompt, not a silent overwrite

Setup says: *"Title fallback: when neither `design_doc_id` nor `design_doc_title` is supplied, derive `design_doc_title` from the dominant heading (H1) of the first `file_paths` entry … Confirm via `AskUserQuestion` only when … the derived title collides with an existing doc."* Combined with `prepareDesignDocPath` minting a UUIDv7 whenever no `id` is supplied, a derived-title collision currently creates a *new* doc with a near-identical filename but different id — easy to mistake for iteration. The collision branch should default to "iterate on existing" unless the user explicitly says otherwise.

### 3.7 Add a self-test fixture for the iterate-after-modified flow

`tests/unit/.../design-docs.read.test.ts` exercises only the all-`added` path (`modified: [], removed: []` throughout). Add fixtures that mirror `tierExpansionDesignDoc` (modified-at-every-level) and assert that `formatDesignDoc` surfaces every `modified` and `removed` entry. Without these, the renderer fix in §3.2 can be silently re-broken.

---

## 4. Misconceptions in the skill text

- **"The diff baseline is the implemented codebase"** is the correct rule, but the Step-1 sub-steps that operationalise it (§1.0a, §1.3, §1.4, §1.5) all reach for prior Design Docs. The text and the workflow contradict.
- **"Save is the ultimate validation."** False under current implementation — save validates only Zod parse + top-level locks. The skill's fix-and-retry loop expects rich error responses that the server never produces.
- **"`read_design_doc` writes a Markdown rendering of the full current state."** False — only the `added` slot is rendered, and even when fixed the tool returns *this doc's diff*, not the implemented model.
- **"`noesis-graph` provenance fields, when exposed, indicat[e] whether implement-design-doc has run on the prior design doc."** Under invariant (3) this is irrelevant — provenance does not equal implementation status, because manual commits exist.
- **"§3 ChangeSet rules apply recursively."** Technically true but doesn't say the rule is *cascading*: when a leaf changes, every ancestor must also be `modified` with the identity `name`. State this outright.
- **"The actor field is set only on `application_service` behaviours" + "save_design_doc rejects an actor on any other host type."** No such rejection in the service; the file is written verbatim.
- **"There is no `DesignDoc.actors` field."** Wrong — the Zod schema still has it, and the upsert path uses it to decide whether to draw `BEHAVIOUR_PERFORMED_BY_ACTOR`. Either remove the field or align the spec.

---

## 5. Recommended fix order

1. **Rewrite Step 1 of SKILL.md around the scanner** (§2.1, §3.1). Delete §1.0a / §1.3 / §1.4 / §1.5. Replace with a single `get_domain_model` call producing `baseline-model.md`. This is the biggest correctness win because it aligns the workflow with invariant (3) and picks up manual code edits.
2. **Render all three slots in `read_design_doc`** (§3.2). Fixes iteration-after-modify.
3. **State the cascading-modified rule explicitly** (§2.2). Pure documentation.
4. **Implement save-time validations** (§3.3), with the scanner output as the resolution target.
5. **Resolve the `file.actors` contradiction** (§3.4).
6. **Demote design-doc readers used in the baseline pipeline to administrative status** (§3.5).
7. **Tests for modified/removed renders** (§3.7).
