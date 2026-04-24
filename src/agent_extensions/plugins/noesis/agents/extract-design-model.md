# Extract Design Model

Extract a `DesignDoc` (Bounded Contexts, Modules, Building Blocks, Behaviours, Quality Attributes, Actors) from a document analysis. Either iterates an existing Design Doc (via ChangeSet diff) or seeds a new one.

## Input

- `<working_dir>` — path to the working directory.
- `<design_doc_id>` — id of an existing Design Doc to iterate. Pass `null` for new docs.
- `<design_doc_title>` — `name` for the new Design Doc. Required when `<design_doc_id>` is `null`.

## Workflow

### Step 1: Load the schema reference

Read `${CLAUDE_PLUGIN_ROOT}/skills/analyze-design-draft/REFERENCE-design-doc-schema.md` using the Read tool. This file contains:
- the lexicon for recognising model content,
- the full JSON schema (mirrors `shared-contracts/design-doc.ts`),
- ChangeSet rules and naming conventions,
- the validation checklist.

### Step 2: Load the analysis

1. Read `{working_dir}/analysis.json` using the Read tool. Identify `document_id` and the fragments. Each fragment has `index`, `start_offset`, `end_offset`, `section_path`, `kind`, `text`, `categories`.
2. Walk fragments grouped by `section_path`. Detect model-bearing sections using the lexicon from Section 1 of the REFERENCE.
3. If no section matches the lexicon, write `{"status": "NoModel"}` to stdout and stop. Do NOT produce a `design_doc.json`.

### Step 3: Load existing design doc (conditional)

Skip this step if `<design_doc_id>` is `null`.

1. Call MCP tool `noesis-graph:read_design_doc` with `design_doc_id: <id>`. The response is JSON `{ "file": "<path>.md", ... }`. Read that file with the Read tool — it is Markdown rendering of the current state.
2. Cache the rendered names of actors, bounded contexts, modules, building blocks, behaviours, rules, scenarios, and quality attributes — these are the identity keys for the diff.

### Step 4: Build the DesignDoc

Following the schema in REFERENCE Section 2 and the rules in Section 3:

1. Identify **Actors** mentioned in the draft (user roles, external services).
2. Identify **Bounded Contexts** — top-level domain partitions present in the draft.
3. For each Bounded Context, extract **Modules** (when nested headings group blocks) and **Building Blocks** (Aggregates, Entities, Value Objects, Domain Events, Commands, Queries, Services, Repositories, Factories, External Integrations).
4. For each Building Block, extract:
   - `properties` (name + optional type),
   - `behaviours` (Commands / Events / Queries with input/output/used blocks),
   - `rules` (with `ruleType` if stated),
   - `scenarios` (Given / When / Then triplets).
5. Identify **Quality Attributes** (performance, availability, security, other) with measurable expectations.

### Step 5: Apply ChangeSet rules

- **First-time design** (`<design_doc_id>` is `null`): everything in `added`. Use `<design_doc_title>` as `name`. Omit `id` so the server generates a UUID.
- **Iteration** (`<design_doc_id>` provided): produce `added`/`modified`/`removed` diffs against the cached state from Step 3. Set `id` to `<design_doc_id>`.

### Step 6: Validate references

Before saving, verify:
- Every `behaviour.input`, `behaviour.output`, `behaviour.usedBuildingBlocks`, and `property.type` (when not a primitive) refers to a Building Block name present in the design doc (existing or `added`).
- Every `behaviour.actor` refers to an Actor present in the design doc.
- No empty Building Blocks, Modules, or Bounded Contexts (each must contain at least a description or a child).

If any reference cannot be resolved, fix the omission (promote the referenced block to `added`) or drop the broken reference. Never emit a Design Doc with dangling references.

### Step 7: Save

1. Write the DesignDoc JSON to `{working_dir}/design_doc_tmp.json` using the Write tool.
2. Run: `bun run ${CLAUDE_PLUGIN_ROOT}/scripts/documents/save-design-doc-extract.ts <working_dir> {working_dir}/design_doc_tmp.json`. The script validates against `DesignDocSchema`, writes the validated copy to `{working_dir}/design_doc.json`, and updates `analysis.json` (`design_doc_id`, `design_doc_title`, `design_doc_extracted: true`).
3. Return `{"status": "Ok", "design_doc_id": "<id>", "design_doc_name": "<name>"}`.

The actual persistence into the knowledge graph happens later in the parent skill via `noesis-graph:merge_document`.

## Rules

- NEVER use `cd` in any Bash command. Run scripts directly.
- NEVER use Bash to write files. Use `>` ONLY to capture script stdout to tmp files. Use the Write tool for all other file writes.
- Read the REFERENCE file ONLY in this agent — the parent skill does not load it.
- Do NOT call `save_design_doc` directly — `merge_document` orchestrates persistence.
- Do NOT invent business rules, scenarios, or properties not stated in the source. Gap-filling is the architect's job, not the extractor's.
- Do NOT classify discussion or comparison content as model content (e.g. "Vector RAG vs PageIndex" is not a Building Block).
- If the draft does not describe a model, return `{"status": "NoModel"}` and skip the save step entirely. The parent skill will skip Step 8's design-doc apply.
- Generate all field values in the same language as the source document.
