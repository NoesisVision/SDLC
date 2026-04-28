---
name: noesis:create-design-doc
description: Produce or iterate a Design Doc that meets new requirements. Pulls evidence from existing graph conversations, documents and decisions plus arbitrary user-provided files, plans the diff against the current Bounded Context map, and persists the result as JSON.
---

# Create Design Doc

The main agent does the reasoning. Pull evidence from the knowledge graph via `noesis-graph` MCP tools, analyse it as an experienced architect and analyst would, and emit a `DesignDoc` JSON expressed as a diff (added / modified / removed) from the current model.
Persistence happens via `noesis-graph:save_design_doc`; never write graph data directly.

Use **progressive disclosure** for analysis files: every analysis sub-step writes its findings to a separate Markdown file under `<working_dir>` and is then offloaded from the agent's context. Reload only when later steps need it.

## Pre-flight reads

Before Setup, load these reference files in a **single parallel `Read` batch** and keep them in active context for the rest of the run — their constraints govern Step 3 outputs and Step 4 serialisation:

- `${CLAUDE_PLUGIN_ROOT}/skills/create-design-doc/references/modularization.md` (governs §3.1)
- `${CLAUDE_PLUGIN_ROOT}/skills/create-design-doc/references/business_rules.md` (governs §3.3)
- `${CLAUDE_PLUGIN_ROOT}/skills/create-design-doc/references/bdd_examples.md` (governs §3.4)
- `${CLAUDE_PLUGIN_ROOT}/skills/create-design-doc/references/tactical-ddd.md` (governs §3.5)
- `${CLAUDE_PLUGIN_ROOT}/skills/analyze-design-draft/references/design-doc-schema.md` (governs §3.3 / §3.4 / §3.5 outputs and §4 serialisation — its length minimums, mermaid requirements, naming conventions and `input` / `output` / `usedBuildingBlocks` BB-name-only constraint must be respected during analysis, not just at JSON build time)

These references are knowledge inputs — they are exempt from the **Minimum reload principle**, which applies only to scratch analysis files.

## Setup

Parse arguments from `$ARGUMENTS` using these conventions, then ask the user for anything missing:

| Token form | Routes to |
|---|---|
| `@<path>` or bare path | `file_paths` |
| `id:<uuid>` | `design_doc_id` |
| `title:"<text>"` | `design_doc_title` |
| `conv:<id>` | `conversation_ids` |
| `doc:<id>` | `document_ids` |
| `out:<path>` | `design_doc_path` |

Required after parsing:

- **Design Doc target** — exactly one of `design_doc_id` (iterate on existing) or `design_doc_title` (create new). If both are supplied, ask via `AskUserQuestion` which mode the user wants.
- **conversation_ids**, **document_ids**, **file_paths** — at least one of the three lists must be non-empty. If all three are empty, ask via `AskUserQuestion` for at least one source before continuing.
- **design_doc_path** — absolute path for the JSON artefact. Default: `<repo_root>/work_items/<slug>.json`, where `<slug>` is the kebab-case slug of `design_doc_title` (or of the existing doc's name when iterating).

When `design_doc_title` is supplied, call `noesis-graph:list_design_docs` and confirm the title does not collide with an existing doc's name. If it does, ask via `AskUserQuestion` whether to iterate on the existing doc, or pick a new title.

The skill-invocation message itself (the user's prompt body, beyond `$ARGUMENTS`) is the **highest-priority source of intent** — see the **Source of truth ranking** Rule.

Pick a `<working_dir>` for analysis scratch files: a sibling directory of `design_doc_path` named `<basename>.analysis/`. Create it with the Bash tool. **Lifetime:** scratch — never committed. The repository's `.gitignore` should cover `*.analysis/`; if it does not, the user is responsible for cleanup, but the skill must not leave scratch artefacts in version control.

## Workflow

### Step 1: Load graph context

Each sub-step is a single MCP call. Read the returned tmp file, extract what is needed, then offload it (do not reference its content in subsequent prose; reload from disk if you need it back).

**Green-field short-circuit.** If `design_doc_title` was supplied AND `conversation_ids ∪ document_ids` is empty, skip §1.1, §1.2, §1.5 — they have nothing to read. Run §1.3 once; if the BC map returns "(no design docs in the graph yet)", §1.4 has no candidate list to produce either. Proceed straight to Step 2.

#### 1.0 Existing Design Doc baseline

Run only when iterating (i.e. `design_doc_id` was provided in Setup). Call `noesis-graph:read_design_doc` with that id. The tool writes a Markdown rendering of the full current state (actors, bounded contexts → modules → building blocks → behaviours, rules, scenarios, quality attributes) to a tmp file and returns the path. Read it once to orient, then offload it — it will be re-read in Step 4 as the authoritative baseline for the diff.

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

The candidate-list from §1.4 is no longer needed after this — offload it.

### Step 2: Survey arbitrary files

User-provided files in `file_paths` carry the **highest priority** — they are the freshest evidence. Read each one. For every file, write a one-paragraph index entry to `<working_dir>/input-files-index.md`:

- What kinds of information the file contains (requirements, decisions, diagrams, BDD, glossary, …).
- Roughly where to find each kind (section / heading anchors).
- Any decision, term, rule or scenario from §1 that this file contradicts or refines — flag it explicitly.

Do **not** dive into the substance yet — Step 3 does that. The index is a navigation map for §3.

### Step 3: Analyse

Each sub-step writes to its own scratch file in `<working_dir>` and is then offloaded.

**Concurrency:** §3.2, §3.3, §3.4, §3.5 are independent once `input-files-index.md` exists. Run them concurrently when the agent supports it (parallel `Write` calls); §3.6 reconciles. §3.1 must finish first because §3.2–§3.5 assign findings to its BCs. §3.7 depends on §3.6.

#### 3.1 Bounded Context fit

Decide how new requirements distribute over existing Bounded Contexts. Follow the **Approval gates** Rule for any proposed new Bounded Context or relation change.

Write findings to `<working_dir>/analysis-bounded-contexts.md`:
- Bounded Contexts in scope and the slice of requirements assigned to each.
- Proposed relation changes (with rationale) — must be confirmed.
- Proposed new Bounded Contexts (with rationale) — confirmation rules per **Approval gates**.

#### 3.2 Process flow, actors & use cases

Identify use cases — actions triggerable from outside a Bounded Context by Command, Event or Query. **A use case is a public Behaviour** (`isPublic: true`, `type: Command | Event | Query`). Group cohesive use cases under one `application_service` Building Block; do not 1:1-map every use case to its own service.

Identify the **actors** that initiate those Behaviours (humans, external systems, scheduled triggers). The actor list in `DesignDoc.actors` is produced here, not invented at Step 4.

When the input contains a table, decide what the table represents before treating its rows as model elements:
- *Each row has distinct behaviour or invariants* → row = Building Block.
- *Rows describe attributes of one element* → row = property of that element's BB.
- *Rows are runtime data the system reads/writes* → not modelled as BBs; the table is operational data outside the design doc (or, if structurally relevant, captured as configuration of a single aggregate BB).

Write findings to `<working_dir>/analysis-process.md`:
- Per Bounded Context: the use case list with target Module, triggering Behaviour name & type, hosting `application_service` BB, initiating Actor, and one-line purpose.
- Actor list: name + one-line description.

#### 3.3 Business rules

Find every business rule expressed in the gathered evidence. Categorise each via the catalog in `business_rules.md`. A Rule attaches to a Building Block when it constrains that block's data shape or invariants; it attaches to a Behaviour when it gates a single transition.

Write findings to `<working_dir>/analysis-rules.md`:
- One entry per Rule: name, type, description, attachment target.

#### 3.4 Scenarios

Collect business scenarios in Given-When-Then form. Attach a scenario to its Rule when it directly verifies one Rule; attach to a Behaviour when it spans the whole use case; attach at Building Block level only when it is a cross-Behaviour Rule. Use the scenario evidence to refine §3.3 — a scenario that doesn't map to any known Rule usually exposes a missing Rule.

Write findings to `<working_dir>/analysis-scenarios.md`:
- One entry per scenario: name, description, given/when/then, attachment target.

If §3.3 needs adjustment: **read the full `analysis-rules.md` first**, edit, then write the full file back. No blind partial rewrites.

#### 3.5 Ready model solutions

Mine the inputs for ready domain-model solutions: Modules, Building Blocks, Behaviours, interactions between Building Blocks, Rule-to-Behaviour assignments. Pay close attention to UML/C4 class, sequence and component diagrams (and equivalent notations) — they often capture model decisions that prose only hints at.

**Behaviour signatures.** `input` and `output` are lists of Building Block names. When a Behaviour takes or returns a primitive (`Instant`, `BigDecimal`, `Boolean`, …), do not list a broad parameter bundle and do not omit the field — list the smallest VO that owns the primitive, or introduce a thin `value_object` Building Block (`Timestamp`, `Quantity`, …) when no VO exists.

**Property types must resolve.** Every `properties[].type` must be either a Building Block declared in this doc, a primitive, or a primitive enum literal. Phantom type names (`ApplicabilityPredicate`, `QuantitySource`, …) that don't resolve will be rejected at save; catch them while authoring this file.

Write findings to `<working_dir>/analysis-model.md`:
- Per Bounded Context → Module → Building Block: type, properties (with resolved types), behaviours (with resolved signatures), ruleset references (point at entries from §3.3), scenario references (§3.4), and inbound/outbound interactions (which other Building Blocks are used).

#### 3.6 Compile

Read all five analysis files together — issue a **single parallel `Read` batch**, not five sequential reads. Find:

- Contradictions between sources (esp. §1 vs §2-files).
- Missing information needed to commit to the model.
- Multiple plausible solutions.

For each finding, decide whether the resolution is **obvious**: a resolution is obvious only when supported by an explicit statement in §1 or in a Step-2 input file. Inference, extrapolation, or "reasonable defaults" do **not** count as obvious — escalate those via `AskUserQuestion`.

When applying an obvious resolution directly, append the choice to the relevant analysis file under a `## Resolutions` heading; do not bury it in prose.

Otherwise build a list of well-formed questions, each with 2-3 candidate answers, and present them via `AskUserQuestion`. Continue only after the user has decided.

#### 3.7 Cross-cutting qualities

Identify quality attributes (performance, availability, security, …) that cannot be localised to a single Building Block or Behaviour. **Guard:** do not restate something already captured as a Rule attached to a specific block — quality attributes are for properties not localisable to one place.

Write findings to `<working_dir>/analysis-qualities.md`:
- One entry per quality attribute: name, type, description, scope (whole DesignDoc or specific BCs).

### Step 4: Produce the Design Doc

Build a `DesignDoc` payload using the schema rules already loaded in **Pre-flight reads**.

- If iterating, re-read the existing Design Doc loaded in §1.0 — that is the authoritative baseline for the diff. Items present there but absent from the new model become `removed` (by name). Items present in both with changed fields become `modified`. New items become `added`. Apply this rule recursively to nested ChangeSets. (§1.5 may be consulted for related BCs that live in other Design Docs, but it is not the baseline.)
- If creating, every item goes into `added`; `modified` and `removed` stay empty.

Self-check before saving: every reference in `usedBuildingBlocks`, `input`, `output`, and every `properties[].type` must resolve to a Building Block declared in the produced doc, in the prior model loaded in §1.5 (for iteration), to a primitive, or to a primitive enum literal.

Write the validated JSON to `<design_doc_path>` (this is the version-controlled artefact). Then call `noesis-graph:save_design_doc` with `path: <design_doc_path>`.

If `save_design_doc` fails after the JSON file write succeeded, the file is the source of truth — fix the offending fields in place and re-call `save_design_doc` until it succeeds. Do not delete the file on failure.

If `save_design_doc` returns warnings, address every warning (re-edit the JSON, re-save) until the warning list is empty or the user has explicitly accepted a remaining warning via `AskUserQuestion`.

Report the returned `design_doc_id` and the totals (`added` / `modified` / `removed`) to the user.

## Rules

- **Source of truth ranking.** When sources disagree, trust in this order: skill-invocation message (the user's prompt body — inline requirements, decisions, constraints, terminology) → `file_paths` (Step 2) → decisions (§1.2) → topic summaries (§1.1) → existing model (§1.0 / §1.5). The newest, most explicit evidence wins.
- **Approval gates.** A new Bounded Context, or any change to a relation between Bounded Contexts, requires explicit user confirmation via `AskUserQuestion`. **Green-field carve-out:** confirmation is implicit — and may be skipped — only when (a) the BC map (§1.3) is empty AND (b) the user-supplied `design_doc_title` (or the invocation prompt) explicitly names the BC being introduced. In any other case `AskUserQuestion` is mandatory.
- **Deep-dive on demand.** When a topic summary leaves a question open, call `noesis-graph:list_topic_items_since` with `{ topic_id, since? }`. With `since`, the tool returns only items (IdeaUnits, DocumentFragments) created after that timestamp; without it, all items. Output is a tmp file — read it, extract what you need, drop it.
- **Minimum reload principle.** Each analysis sub-step lives in its own file. After writing it, do not keep its content in active context unless a later step needs it; reload from disk on demand. (Pre-flight references are exempt — keep them resident.)
- **Rule terminology.** The schema entity is `Rule` (`DesignedRule`). Detection cues in source material may say "Invariant" or "Constraint", but in this skill's output and prose use **Rule** consistently.
- **Use existing references unmodified.** The `references/` directory is curated input; do not edit it as part of this skill's run.
- **Persist via MCP only.** Edit the design doc JSON locally, then hand the path to `noesis-graph:save_design_doc` — do not call lower-level graph mutations.
