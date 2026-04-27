# Extract design model

Used by `noesis:analyze-design-draft` Step 6.

Read this together with `design-doc-schema.md` (lexicon, full JSON schema, ChangeSet rules, validation checklist).

## Decide whether the document describes a model

Walk the fragments grouped by `section_path`. Detect model-bearing sections using the lexicon in `design-doc-schema.md` Section 1. If no section matches the lexicon, the document does not describe a model — skip the rest of this step. Do NOT produce a `design_doc.json`, and do NOT call `save_design_doc`.

## Build the DesignDoc

Following the schema in `design-doc-schema.md` Section 2 and the rules in Section 3:

1. **Actors** — user roles, external services mentioned in the draft.
2. **Bounded Contexts** — top-level domain partitions.
3. For each Bounded Context:
   - **Modules** when nested headings group blocks.
   - **Building Blocks** — Aggregates, Entities, Value Objects, Domain Events, Commands, Queries, Services, Repositories, Factories, External Integrations.
4. For each Building Block:
   - `properties` (name + optional type),
   - `behaviours` (Commands / Events / Queries with `input` / `output` / `usedBuildingBlocks`),
   - `rules` (with `ruleType` if stated),
   - `scenarios` (Given / When / Then triplets).
5. **Quality Attributes** — performance, availability, security, etc., with measurable expectations.

## ChangeSet rules

- **First iteration** (`<design_doc_id>` is `null`): everything in `added`. Use `<design_doc_title>` as `name`. Omit `id` so the server generates a UUID.
- **Subsequent iteration** (`<design_doc_id>` provided): call `noesis-graph:read_design_doc`, read the returned file, cache the names that act as identity keys, and produce `added` / `modified` / `removed` diffs against that cached state. Set `id` to `<design_doc_id>`.

## Reference validation

Before saving, verify:

- Every `behaviour.input`, `behaviour.output`, `behaviour.usedBuildingBlocks`, and non-primitive `property.type` refers to a Building Block name present in the design doc (existing or `added`).
- Every `behaviour.actor` refers to an Actor present in the design doc.
- No empty Building Blocks, Modules, or Bounded Contexts (each must have at least a description or a child).

If a reference cannot be resolved, fix the omission (promote the referenced block to `added`) or drop the broken reference. Never emit a Design Doc with dangling references.

## Save

Persistence is handled by SKILL.md Step 6. Do not duplicate Save instructions here.

The model is persisted by `save_design_doc` (Step 6); topics, fragments, decisions, and decision attachments are persisted by `merge_document` (Step 7). Two distinct commits — keep them separate.

## Don'ts

- Do NOT invent business rules, scenarios, or properties not stated in the source. Gap-filling is the architect's job, not the extractor's.
- Do NOT classify discussion or comparison content as model content (e.g. "Vector RAG vs PageIndex" is not a Building Block).

## Language

Match the source document's language for all field values.
