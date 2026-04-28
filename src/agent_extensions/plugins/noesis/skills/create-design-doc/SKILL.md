---
name: noesis:create-design-doc
description: Produce or iterate a Design Doc that meets new requirements. Pulls evidence from existing graph conversations, documents and decisions plus arbitrary user-provided files, plans the diff against the current Bounded Context map, and persists the result as JSON.
---

# Create Design Doc

The main agent does the reasoning. Pull evidence from the knowledge graph via `noesis-graph` MCP tools, analyze it as experienced architect and analyst would, and emit a `DesignDoc` JSON expressed as a diff (added / modified / removed) from the current model.
Persistence happens via `noesis-graph:save_design_doc`; never write graph data directly.

Use **progressive disclosure**: every analysis step writes its findings to a separate Markdown file under `<working_dir>` and is then offloaded from the agent's context. Reload only when later steps need it.

## Setup

Get from `$ARGUMENTS`, ask the user for anything missing:

- **Design Doc target** — exactly one of:
  - `design_doc_id` — iterate on an existing Design Doc (diff against its current state).
  - `design_doc_title` — create a new Design Doc with this name.
- **conversation_ids** — list of Conversation ids already in the graph (may be empty).
- **document_ids** — list of Document ids already in the graph (may be empty).
- **file_paths** — list of absolute paths to arbitrary user-provided files (may be empty).
- **design_doc_path** — absolute path where the Design Doc JSON must be written. Suggest `work_items/<name>.json` if absent.

At least one of `conversation_ids`, `document_ids`, `file_paths` must be non-empty.

The skill-invocation message itself (the user's prompt body, beyond `$ARGUMENTS`) is the **highest-priority source of intent**. Capture any inline requirements, decisions, constraints, or terminology stated there and treat them as authoritative when sources disagree — they outrank file contents, prior decisions, topic summaries, and the existing model.

Pick a `<working_dir>` for analysis scratch files: a sibling directory of `design_doc_path` named `<basename>.analysis/`. Create it with the Bash tool.

## Workflow

### Step 1: Load graph context

Each sub-step is a single MCP call. Read the returned tmp file with the Read tool, extract what is needed, then drop the file from active reasoning — it can always be re-read.

#### 1.0 Existing Design Doc baseline

Run only when iterating (i.e. `design_doc_id` was provided in Setup). Call `noesis-graph:read_design_doc` with that id. The tool writes a Markdown rendering of the full current state (actors, bounded contexts → modules → building blocks → behaviours, rules, scenarios, quality attributes) to a tmp file and returns the path. Read it once to orient, then drop it from active context — it will be re-read in Step 4 as the authoritative baseline for the diff.

If creating a new Design Doc (`design_doc_title` was provided), skip this sub-step. Step 4 will emit everything as `added`.

#### 1.1 Topic long summaries

Call `noesis-graph:list_topic_summaries_for_sources` with `{ conversation_ids, document_ids }`. The tool writes Markdown (one section per topic: id, path, long summary) to a tmp file and returns the path. Read it.

#### 1.2 Decision records

Call `noesis-graph:list_decisions_for_sources` with `{ conversation_ids, document_ids }`. The tool writes Markdown (one section per decision: title, status, context, decision text, rationale, alternatives) to a tmp file and returns the path. Read it.

#### 1.3 Bounded Context map

Call `noesis-graph:read_bounded_context_map`. The tool returns a small Markdown payload **inline via stdio** (no tmp file). It is a hierarchical list of every Bounded Context across all Design Docs and each Bounded Context's modules. The Relations section is included when relations are present in the graph; today the relation domain is not yet modelled, so the section may be empty — surface relations only when they are present in the input files (Step 2) or the user's prior decisions (§1.2).

#### 1.4 Determine in-scope Bounded Contexts and Modules

Reason from §1.1 and §1.2 against the BC map from §1.3. Decide which existing Bounded Contexts and Modules the requirements touch. Capture the chosen list as `(bounded_context_name, module_path?)` pairs — keep this list in active context for §1.5.

#### 1.5 Existing model for in-scope Bounded Contexts and Modules

Call `noesis-graph:read_model_for_modules` with the pairs from §1.4. The tool writes Markdown (Bounded Context → Module → Building Block → Behaviour, with rules and scenarios) to a tmp file and returns the path. Read it.

The candidate-list from §1.4 is no longer needed after this — drop it from active context.

### Step 2: Survey arbitrary files

User-provided files in `file_paths` carry the **highest priority** — they are the freshest evidence. Read each one. For every file, write a one-paragraph index entry to `<working_dir>/input-files-index.md`:

- What kinds of information the file contains (requirements, decisions, diagrams, BDD, glossary, …).
- Roughly where to find each kind (section / heading anchors).
- Any decision, term, rule or scenario from §1 that this file contradicts or refines — flag it explicitly.

Do **not** dive into the substance yet — Step 3 does that. The index is a navigation map for §3.

### Step 3: Analyse

Each sub-step writes to its own scratch file in `<working_dir>` and is then offloaded. Re-read on demand.

#### 3.1 Bounded Context fit

Detailed rules: read `${CLAUDE_PLUGIN_ROOT}/skills/create-design-doc/references/modularization.md`.

Decide how new requirements distribute over existing Bounded Contexts. Changing a Bounded Context **relation** (dependency direction or integration pattern) and adding a **new** Bounded Context both require user approval — collect such proposals and confirm them via `AskUserQuestion` before continuing.

Write findings to `<working_dir>/analysis-bounded-contexts.md`:
- Bounded Contexts in scope and the slice of requirements assigned to each.
- Proposed relation changes (with rationale) — must be confirmed.
- Proposed new Bounded Contexts (with rationale) — must be confirmed.

#### 3.2 Process flow & use cases

Identify use cases — actions triggerable from outside a Bounded Context by Command, Event or Query. Each use case is a Building Block of type `application_service`; its public Behaviours are the entry points (`isPublic: true`, with `type: Command | Event | Query`). Assign each use case to a Module within its owning Bounded Context.

Write findings to `<working_dir>/analysis-process.md`:
- Per Bounded Context, the use case list with target Module, triggering Behaviour name & type, and one-line purpose.

#### 3.3 Business rules

Detailed rules: read `${CLAUDE_PLUGIN_ROOT}/skills/create-design-doc/references/business_rules.md`.

Find every business rule expressed in the gathered evidence. Categorise each via the catalog (Structural Contract, Validation, Calculation, Categorization, State-Change, Process-Flow). A rule attaches to a Building Block when it constrains that block's data shape or invariants; it attaches to a Behaviour when it gates a single transition.

Write findings to `<working_dir>/analysis-rules.md`:
- One entry per rule: name, type, description, attachment target.

#### 3.4 Scenarios

Detailed rules: read `${CLAUDE_PLUGIN_ROOT}/skills/create-design-doc/references/bdd_examples.md`.

Collect business scenarios in Given-When-Then form. Attach a scenario to its rule when it directly verifies one rule; attach to a Behaviour when it spans the whole use case; attach at Building Block level only when it is a cross-Behaviour invariant. Use the scenario evidence to refine §3.3 — a scenario that doesn't map to any known rule usually exposes a missing rule.

Write findings to `<working_dir>/analysis-scenarios.md`:
- One entry per scenario: name, description, given/when/then, attachment target. Update `analysis-rules.md` if §3.3 needs adjustment.

#### 3.5 Ready model solutions

Detailed rules: read `${CLAUDE_PLUGIN_ROOT}/skills/create-design-doc/references/tactical-ddd.md`.

Mine the inputs for ready domain-model solutions: Modules, Building Blocks, Behaviours, interactions between Building Blocks, rule-to-Behaviour assignments. Pay close attention to UML/C4 class, sequence and component diagrams (and equivalent notations) — they often capture model decisions that prose only hints at.

Write findings to `<working_dir>/analysis-model.md`:
- Per Bounded Context → Module → Building Block: type, properties, behaviours, ruleset references (point at entries from §3.3), scenario references (§3.4), and inbound/outbound interactions (which other Building Blocks are used).

#### 3.6 Compile

Read all five analysis files together. Find:
- Contradictions between sources (esp. §1 vs §2-files).
- Missing information needed to commit to the model.
- Multiple plausible solutions.

If a resolution is obvious, apply it directly and note the choice in the relevant analysis file. Otherwise build a list of well-formed questions, each with 2-3 candidate answers, and present them via `AskUserQuestion`. Continue only after the user has decided.

### Step 4: Produce the Design Doc

Detailed schema and ChangeSet semantics: read `${CLAUDE_PLUGIN_ROOT}/skills/analyze-design-draft/references/design-doc-schema.md`.

Build a `DesignDoc` payload:

- If iterating, re-read the existing Design Doc loaded in §1.0 — that is the authoritative baseline for the diff. Items present there but absent from the new model become `removed` (by name). Items present in both with changed fields become `modified`. New items become `added`. Apply this rule recursively to nested ChangeSets. (§1.5 may be consulted for related BCs that live in other Design Docs, but it is not the baseline.)
- If creating, every item goes into `added`; `modified` and `removed` stay empty.

Validate locally: every reference in `usedBuildingBlocks`, `input`, `output` must resolve to a Building Block name that exists in the produced doc OR in the prior model loaded in §1.5.

Write the validated JSON to `<design_doc_path>` (this is the version-controlled artefact). Then call `noesis-graph:save_design_doc` with `path: <design_doc_path>`. Report the returned `design_doc_id` and the totals (`added` / `modified` / `removed`) to the user.

## Rules

- **Source of truth ranking.** When sources disagree, trust in this order: skill-invocation message (the user's prompt body — inline requirements, decisions, constraints, terminology) → `file_paths` (Step 2) → decisions (§1.2) → topic summaries (§1.1) → existing model (§1.0 / §1.5). The newest, most explicit evidence wins.
- **Deep-dive on demand.** When a topic summary leaves a question open, call `noesis-graph:list_topic_items_since` with `{ topic_id, since? }`. With `since`, the tool returns only items (IdeaUnits, DocumentFragments) created after that timestamp; without it, all items. Output is a tmp file — read it, extract what you need, drop it.
- **Approval gates.** Never persist a relation change between Bounded Contexts or a new Bounded Context without explicit user confirmation via `AskUserQuestion`.
- **Minimum reload principle.** Each analysis sub-step lives in its own file. After writing it, do not keep its content in active context unless a later step needs it; reload from disk on demand.
- **Use existing references unmodified.** The `references/` directory is curated input; do not edit it as part of this skill's run.
- **Persist via MCP only.** Edit the design doc JSON locally, then hand the path to `noesis-graph:save_design_doc` — do not call lower-level graph mutations.
