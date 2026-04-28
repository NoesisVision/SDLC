# Review of `noesis:create-design-doc`

Review of the skill itself, generalised from one example execution and from a close re-read of `SKILL.md` plus its references and the sibling `design-doc-schema.md`. Findings are framed as "what would go wrong across many possible runs", not as defects of any single output.

## 1. Execution time

### 1.1 Step 1 fires four MCP round-trips even when the graph is empty
`§1.1`, `§1.2`, `§1.3`, `§1.5` are unconditional. On a fresh project — or whenever `design_doc_title` is supplied for a green-field doc — they all return effectively empty markdown. The skill never short-circuits. **Fix:** after `§1.3` returns "(no design docs in the graph yet)" or `conversation_ids ∪ document_ids` is empty, mark `§1.1`/`§1.2`/`§1.5` as no-ops in SKILL.md.

### 1.2 Sequential references with no parallel-read hint
Steps 3.1 / 3.3 / 3.4 / 3.5 each instruct an inline `Read` of a different reference file. Agents read them one at a time. The four files total ~10 KB. **Fix:** SKILL.md should explicitly say "before Step 3, read all four references in a single parallel batch" — or just preload them at session start (treat them like the schema reference).

### 1.3 No instruction to parallelise §3.2 – §3.5
Once `input-files-index.md` exists, the four analysis sub-steps are largely independent. SKILL.md presents them strictly sequentially. **Fix:** explicitly authorise running `analysis-process.md`, `analysis-rules.md`, `analysis-scenarios.md`, `analysis-model.md` writes concurrently (or as concurrently as the agent supports) and reconcile in §3.6.

### 1.4 §3.6 forces a serial 5-file reload
"Read all five analysis files together" is the right idea, but SKILL.md doesn't say "do this in one parallel Read batch". Agents tend to read one at a time.

### 1.5 Schema reference loaded only at Step 4
`design-doc-schema.md` is loaded in Step 4 — *after* the analyses are written. Agents end up authoring rules/behaviours in §3.3/§3.4/§3.5 without knowing the schema's length minimums, mermaid requirements, naming conventions, or the BB-name-only constraint on `input`/`output`. They then have to inflate descriptions and rework signatures at JSON-build time. **Fix:** load the schema reference up front (its constraints govern Step 3 outputs, not just Step 4 serialisation). This single fix subsumes the need to restate length gates, mermaid rules, or naming conventions in individual §3 sub-steps.

## 2. Output quality

### 2.1 No guidance for primitive-typed inputs and outputs
Schema's `input?: ChangeSet<string>` is "BuildingBlock names" — but real behaviours frequently take primitives (`Instant`, `BigDecimal`, `Boolean`). SKILL.md is silent. Agents work around it by listing an over-broad VO (e.g., the entire parameter bundle) and lose signature precision, or omit the field and lose structure. **Fix:** add explicit guidance — either "list the smallest VO that owns the primitive" or "introduce a thin `value_object` (e.g. `Timestamp`, `Quantity`) when no VO exists."

### 2.2 Phantom property types pass through analysis
`DesignedProperty.type` is free-form. Agents reference type names (`ApplicabilityPredicate`, `QuantitySource`) and forget to declare them as Building Blocks or replace with primitives. `save_design_doc` rejects this, but the rejection comes after the full JSON has been authored. **Fix:** add a §3 authoring rule — "every type referenced in any `properties[].type` must resolve to a BB declared in this doc, a primitive, or a primitive enum literal" — so the agent self-checks before reaching Step 4.

### 2.3 Quality attributes have no analysis step
Step 3 has no sub-step for `qualityAttributes`. They appear at Step 4 as an afterthought, often duplicating rules already attached to a behaviour. **Fix:** add a §3.7 "Cross-cutting qualities" with a guard: "do not restate something already captured as a Rule on a specific Building Block; QAs are for properties not localizable to a single block."

### 2.4 Actors are under-specified
Step 3.2 mentions actors implicitly ("triggerable from outside a Bounded Context"). The actor *declaration* in `DesignDoc.actors` has no explicit step. Agents either invent actors at Step 4 or omit them. **Fix:** §3.2 should produce the actor list explicitly.

### 2.5 No guidance for tabular input data
Inputs frequently contain tables, and a given table can mean very different things:
- properties of a single Building Block (rows = property entries on one BB),
- a list of Building Blocks (rows = distinct BBs each with their own behaviour and invariants),
- a domain catalogue / classification that may or may not enter the model at all (rows = data the system *operates on*, not structural elements).

Without explicit decision criteria, agents pick inconsistently across runs — sometimes promoting every row to a BB (risking the 20-BB warning), sometimes flattening a real BB list into a single configuration blob. **Fix:** add a decision rubric in §3.2 along the lines of:
- *Each row has distinct behaviour or invariants* → row = Building Block.
- *Rows describe attributes of one element* → row = property of that element's BB.
- *Rows are runtime data the system reads/writes* → not modelled as BBs; the table is operational data outside the design doc (or, if structurally relevant, captured as configuration of a single aggregate BB).

### 2.6 "Use case" / "Behaviour" / "application_service" are conflated in §3.2
> *"Each use case is a Building Block of type `application_service`; its public Behaviours are the entry points."*

A use case is a Behaviour. An `application_service` is a Building Block that may host *multiple* use-case Behaviours. The wording invites a 1:1 mapping and produces over-fragmented services. **Fix:** rewrite §3.2 to say: "Use cases are public Behaviours (`isPublic: true`, `type: Command|Event|Query`). Group cohesive use cases under one `application_service` Building Block."

### 2.7 No cleanup / lifetime spec for `<working_dir>`
SKILL.md never says whether `.analysis/` files should be committed, deleted, or `.gitignore`-d. Result: ambiguous repo state — sometimes scratch artefacts ship, sometimes not.

## 3. Following skill rules — internal contradictions

### 3.1 BC-creation approval gate vs. routine green-field invocation
The "Approval gates" Rule and `modularization.md` both say: "Never create a first-level Module without `AskUserQuestion` approval." But the skill is routinely invoked on a green-field draft whose entire purpose is to introduce one or more BCs. Two outcomes both bad:
- Agent always interrupts → poor UX.
- Agent rationalises an implicit approval → silent rule violation.

**Fix:** define an explicit carve-out: "Implicit approval applies when (a) the graph is empty AND (b) the user-supplied draft titles or names exactly the BC being created. In any other case `AskUserQuestion` is mandatory."

### 3.2 "Source of truth ranking" stated twice with subtle drift
- Setup paragraph: "skill-invocation message ... outranks file contents, prior decisions, topic summaries, and the existing model."
- Rules section: "skill-invocation message → file_paths → decisions → topic summaries → existing model".

Setup uses a flat "outranks the rest" phrasing; Rules uses a strict total order. Reconcile.

### 3.3 "Minimum reload principle" is unenforced
SKILL.md asserts the principle but the workflow inevitably keeps content live (the agent doesn't have a reliable way to evict its own working memory). The principle is honoured only when conversation length forces eviction. **Fix:** either drop the principle or make it actionable (e.g., "after writing each analysis file, summarise its key conclusions in 3 bullets and discard the rest").

### 3.4 At least one of {conversation_ids, document_ids, file_paths} non-empty — never enforced
Setup states the rule but never tells the agent what to do on violation. **Fix:** add a single Setup-time check with `AskUserQuestion` to recover.

### 3.5 `design_doc_id` vs `design_doc_title` exclusivity is unenforced
Setup says "exactly one of" but doesn't specify behaviour when both are supplied, or when a `title` collides with an existing doc's name. **Fix:** add a tie-breaker rule and a duplicate-title check (probably via `list_design_docs`).

### 3.6 Step 3.6's "obvious" resolution criterion is undefined
> *"If a resolution is obvious, apply it directly..."*

In auto-mode, "obvious" expands to "anything I can rationalise." **Fix:** narrow it: "A resolution is obvious only when supported by an explicit statement in §1 or in a Step-2 input file. Inference, extrapolation, or 'reasonable defaults' are not obvious — escalate via `AskUserQuestion`."

### 3.7 `<name>` defaulting in `design_doc_path` is undefined
> *"Suggest `work_items/<name>.json` if absent."*

Slug? PascalCase? Kebab? Relative to repo root or CWD? **Fix:** specify exactly: "kebab-case slug of `design_doc_title`, written under `<repo_root>/work_items/`."

### 3.8 `$ARGUMENTS` parsing convention is implicit
A bare `@path` argument is implicitly routed to `file_paths`. SKILL.md never says so. **Fix:** describe the parsing rules explicitly (one paragraph: bare paths → `file_paths`, `id:<uuid>` → `design_doc_id`, etc.).

### 3.9 `§1.3` carries dated commentary
> *"...today the relation domain is not yet modelled, so the section may be empty..."*

Project-state leakage; will rot when relations are modelled. **Fix:** keep the rule, drop the temporal qualifier.

### 3.10 §3.4's "Update analysis-rules.md if §3.3 needs adjustment" has no read-modify-write protocol
By the time §3.4 runs, §3.3's file is offloaded. SKILL.md doesn't say "Read the file fully before editing." Risk: blind partial rewrites lose earlier rules.

## 4. Skill instruction ambiguities

| # | Where | Ambiguity | Suggested resolution |
|---|---|---|---|
| 4.1 | Setup | "Get from `$ARGUMENTS`" — parsing protocol unspecified | Document `@path → file_paths`, `id:<uuid> → design_doc_id`, `title:"..." → design_doc_title` |
| 4.2 | Setup | `<name>` for default `design_doc_path` | "kebab-case slug of `design_doc_title`" |
| 4.3 | §1.3 | Project-state-dependent ("today...") | Remove the temporal qualifier |
| 4.4 | §1.4 | "Drop from active context" — concrete meaning? | Replace with "do not reference in subsequent prose" |
| 4.5 | §3.2 | "Use case" vs "Behaviour" vs "application_service" conflated | Rewrite per §2.6 above |
| 4.6 | §3.6 | "Obvious resolution" criterion | Narrow per §3.6 above |
| 4.7 | Rules | "Approval gates" duplicated in §3.1 | Centralise in Rules; have §3.1 reference it |
| 4.8 | Step 4 | Behaviour after `save_design_doc` warnings | Add: "address every warning, re-write JSON, re-save until warnings are empty or explicitly accepted" |
| 4.9 | Step 4 | Atomicity of write→save | Specify retry/rollback if `save_design_doc` fails after the file write succeeded |
| 4.10 | §3.4 | Read-modify-write protocol for `analysis-rules.md` | "Read the full file, edit, write the full file" |
| 4.11 | §3.6 | "Apply directly and note the choice" — note where? | "Append to the relevant analysis file under a `## Resolutions` heading" |
| 4.12 | Whole skill | "Rule" vs "Invariant" vs "Constraint" mixed | Pick one term and use it consistently |
| 4.13 | Whole skill | Lifetime of `<working_dir>` | "Scratch — add `*.analysis/` to `.gitignore`; never committed" |

## 5. Cross-cutting recommendations

1. **Promote `design-doc-schema.md` to a Step-0 read.** Its constraints govern §3 outputs, not just §4 serialisation — and a single upfront load eliminates the recurring "constraint surfaces too late" failure mode (length gates, mermaid placement, naming conventions, BB-name-only signatures) without forcing SKILL.md to repeat schema text.
2. **Add a §3.7 "Cross-cutting qualities" sub-step** with explicit non-redundancy rule against rules.
3. **Resolve the BC-approval-gate paradox** with an explicit green-field carve-out.
4. **Consolidate the source-of-truth ranking** into a single canonical paragraph and reference it from each step that needs it.
5. **Add explicit guidance for primitive-typed behaviour signatures, phantom property types, and tabular inputs** — recurring failure modes that aren't fully resolved by the schema alone.
6. **Specify lifetime and naming of scratch artefacts** so repo state is predictable across runs.
