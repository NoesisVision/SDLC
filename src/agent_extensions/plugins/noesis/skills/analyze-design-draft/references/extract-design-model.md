# Extract design model

Used by `noesis:analyze-design-draft` Step 6.

Read this together with `${CLAUDE_PLUGIN_ROOT}/shared-contracts/design-doc-schema.md` (lexicon, full JSON schema, ChangeSet rules, validation checklist).

## Decide whether the document describes a model

Walk the fragments grouped by `section_path`. Detect model-bearing sections using the lexicon in `${CLAUDE_PLUGIN_ROOT}/shared-contracts/design-doc-schema.md` Section 1. If no section matches the lexicon, the document does not describe a model — skip the rest of this step. Do NOT produce a `design_doc.json`, and do NOT call `save_design_doc`.

## Build the DesignDoc

Following the schema in `${CLAUDE_PLUGIN_ROOT}/shared-contracts/design-doc-schema.md` Section 2 and the rules in Section 3:

1. **Bounded Contexts** — top-level domain partitions.
2. For each Bounded Context:
   - **Modules** — required once a Bounded Context grows past ~15 Building Blocks (see "Modularising large Bounded Contexts" below). Skip when the BC is small and flat is fine.
   - **Building Blocks** — Aggregates, Entities, Value Objects, Domain Events, Commands, Queries, Services, Repositories, Factories, External Integrations.
3. For each Building Block:
   - `properties` (name + optional type),
   - `behaviours` (Commands / Events / Queries with `input` / `output` / `usedBuildingBlocks` and, for behaviours hosted by an `application_service`, an optional `actor` referencing the graph-global actor catalog),
   - `rules` (with `ruleType` if stated) — domain concerns only.
   - `scenarios` (Given / When / Then triplets).
   - `qualityAttributes` (technical concerns) — only when the QA is genuinely scoped to this BB; lift to Module/BC if it spans more.
4. **Quality Attributes** at every relevant scope (BC, Module, BB, Behaviour) — attach each at the **narrowest level it actually constrains**. Never attach at root: there is no top-level `qualityAttributes` field.

### Actors (graph-global)

Actors are not part of the DesignDoc tree. Before extracting, call `noesis-graph:list_actors` to load the catalog and reuse names whenever the persona matches. Set `actor` only on behaviours whose host BuildingBlock has `type: application_service`. For any new persona, call `noesis-graph:upsert_actor({ name, description })` **before** `save_design_doc` — the save validates that every referenced actor name exists in the catalog and rejects an actor placed on a non-app-service host.

### Rule vs Quality Attribute

A `Rule` describes a **domain concern**: an invariant, a transition guard, a computation. It belongs to the ubiquitous language and is verified at runtime by domain code (and exercised by Scenarios).

A `QualityAttribute` describes a **technical concern**: latency targets, throughput, availability windows, authn/authz constraints, encryption, observability, … It belongs to operations / security / performance vocabulary and is verified by tests, SLOs, or platform mechanisms.

When a constraint is both, model the domain truth as a Rule and add the operational envelope as a QualityAttribute on the same parent. Do **not** collapse one into the other.

### Modularising large Bounded Contexts

The "do not invent modules from arbitrary headings" rule prevents fabricating modules where the source has none — it does NOT block grouping when the model genuinely needs it.

Once a Bounded Context contains more than ~15 Building Blocks, group them into 3–7 Modules along natural cohesion axes. Before introducing module names, look at the existing topic tree pulled in Step 2 — topics directly under the document's main topic are usually the right module skeleton; **reuse those names rather than inventing fresh ones**. A Module with fewer than 3 Building Blocks is a smell — fold it back into the BC or merge with a sibling.

`save_design_doc` emits a warning when a Bounded Context has >20 building blocks and zero modules. The save still succeeds; treat the warning as a signal to introduce modules in the next iteration.

### Writing rules

Every `Rule` MUST have a `description` of at least **80 characters** that an AI coding agent can implement from. The save tool rejects rules with shorter or missing descriptions, and rejects descriptions that merely paraphrase the rule's `name`.

Structure the description as:

- **Trigger** — when the rule fires.
- **Pre-conditions** — observable state that must hold before.
- **Algorithm** — the steps (or formula) the rule prescribes.
- **Post-conditions** — observable state after.
- **Edge cases** — boundary conditions, rounding, error paths.

For algorithmic rules, give a short pseudocode block or a numbered step list. Tautologies that paraphrase `name` are rejected. Pure rationale without an algorithm is rejected.

**Good** (rule name `"Real delta cancels all forecasts in the same cost category"` — note the name is English even if the source document is in another language; the description below may follow the source language):

> Pre: a real delta is registered in cost category K on PriceState P. Algorithm: find every active (non-storno) delta on P with `flag = forecast` AND `costCategory = K`; for each, create a storno delta (`stornoOf = original_id, amount = -original_amount`) — never UPDATE the existing delta; then register the new real delta. Post: zero active forecasts in K on P; sum of delta amounts in K equals the new real amount. Edge: when real amount equals the forecast sum, effective change is zero, but storno deltas must still be recorded for audit. All operations atomic in one transaction.

**Bad** (`name: "Storno plus new record (not update)"`, `description: "Gwarantuje audyt i prosty zrzut do hurtowni danych."`) — pure rationale, no algorithm, no shape of the storno record. Rejected. (Name translated to English per the language rule; the *content* problem here is the missing algorithm, not the language of the description.)

For `modified` rules, omit `description` when the change does not touch it. Only emit a description when you are deliberately replacing the existing one — and the new value must still meet the ≥80-char bar.

### Writing behaviours

Every `Behaviour` MUST have a `description` of at least **400 characters** that lets an AI coding agent implement it without follow-up questions. The save tool rejects behaviours with shorter or missing descriptions.

The description SHOULD contain (in order):

1. **Input** — the message/command/event with its fields and source.
2. **Validation / preconditions** — what to check before any state change, with the rejection branch for each check.
3. **Steps** — numbered list of state changes / service calls / writes, in order, with the transactional boundary called out explicitly.
4. **Output** — emitted events/messages and what the caller observes.

For behaviours of `type: application_service` OR with `usedBuildingBlocks.added.length ≥ 3`, embed a **mermaid sequence diagram** showing the interaction between the participating Building Blocks. The save tool emits a warning (not an error) when a coupled behaviour has no \`\`\`mermaid block.

Worked example for a behaviour like `PriceState.RegisterDelta`:

> 1. Input: `DeltaRegistrationRequested` with `priceStateId`, `amountPerUnit`, `effectiveDate`, `costCategory`, `sourceDocumentReference`, `flag`.
> 2. Validation: (a) the accounting period containing `effectiveDate` must be open; (b) if `flag = forecast` AND a delta with `flag = real` already exists in this category — reject; (c) if `flag = forecast` AND an active forecast already exists in this category — reject (or replace, depending on policy).
> 3. If `flag = real` and forecasts exist in this category: emit storno deltas for each.
> 4. Create and persist the new delta.
> 5. Call `DeltaPropagationService.PropagateDelta` with the new delta — BFS over the derived-state graph, recompute on each edge by its type (Direct/Disassembly/Assembly).
> 6. Emit `DeltaRegistered` (and `DeltaForecastsStorned` if storno fired).
> 7. All steps in one transaction.
>
> ```mermaid
> sequenceDiagram
>     Caller->>PriceState: DeltaRegistrationRequested
>     PriceState->>AccountingPeriod: assertOpen(effectiveDate)
>     PriceState->>PriceState: emitStornos(forecasts)
>     PriceState->>PriceState: persistDelta(new)
>     PriceState->>DeltaPropagationService: propagate(delta)
>     PriceState-->>Caller: DeltaRegistered
> ```

For `modified` behaviours, omit `description` when the change does not touch it. When you do replace it, the new value must still meet the ≥400-char bar.

## ChangeSet rules

- **First iteration** (`<design_doc_id>` is `null`): everything in `added`. Use `<design_doc_title>` as `name`. Omit `id` so the server generates a UUID.
- **Subsequent iteration** (`<design_doc_id>` provided): call `noesis-graph:read_design_doc`, read the returned file, cache the names that act as identity keys, and produce `added` / `modified` / `removed` diffs against that cached state. Set `id` to `<design_doc_id>`.

## Reference validation

Before saving, verify:

- Every `behaviour.input`, `behaviour.output`, `behaviour.usedBuildingBlocks`, and non-primitive `property.type` refers to a Building Block name present in the design doc (existing or `added`).
- Every `behaviour.actor` refers to a name present in the actor catalog (loaded from `list_actors`); if it does not, register it with `upsert_actor` before saving.
- Every `behaviour.actor` is set on a Behaviour hosted by an `application_service` Building Block — `save_design_doc` rejects actors on any other host.
- No empty Building Blocks, Modules, or Bounded Contexts (each must have at least a description or a child).
- Each Quality Attribute is attached at the narrowest level that covers it, with description ≥80 chars stating a measurable target/threshold/scope.

If a reference cannot be resolved, fix the omission (promote the referenced block to `added`, register a missing actor) or drop the broken reference. Never emit a Design Doc with dangling references.

## Save

Persistence is handled by SKILL.md Step 6. Do not duplicate Save instructions here.

The model is persisted by `save_design_doc` (Step 6); topics, fragments, decisions, and decision attachments are persisted by `merge_document` (Step 7). Two distinct commits — keep them separate.

## Don'ts

- Do NOT invent business rules, scenarios, or properties not stated in the source. Gap-filling is the architect's job, not the extractor's.
- Do NOT classify discussion or comparison content as model content (e.g. "Vector RAG vs PageIndex" is not a Building Block).

## Language

Two separate rules — do not conflate them:

- **Names / identifiers → English**, always. This covers every `name` on a BoundedContext, DesignedDomainModule, DesignedBuildingBlock, DesignedBehaviour, DesignedRule, DesignedScenario, DesignedProperty, DesignedQualityAttribute, plus every cross-reference value (`input`, `output`, `usedBuildingBlocks`, `implements`, `properties[].type`, `behaviour.actor`). Apply the naming conventions in `shared-contracts/design-doc-schema.md` §4 (PascalCase for BBs / behaviours, sentence-form for rule names, etc.). Translate freely from the source language; preserve ubiquitous-language tokens (proper nouns, established domain terms with no clean English equivalent) verbatim and gloss them in English in the matching `description` on first use.
- **Free-text fields → source language is required.** `description`, BDD `given` / `when` / `then`, and any prose body MUST match the source document's language. Do **not** translate prose to English. Mixing English names with source-language descriptions is the intended shape — never collapse the design doc to a single language.
