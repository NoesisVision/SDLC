# `noesis:create-design-doc` — Improvement plan

## 1. What runs already confirm works

Pre-flight parallel reads, schema-loaded-up-front, parallel emission of analysis files, the cross-cutting qualities sub-step, the tabular-input rubric, the use-case/Behaviour/application-service grouping rule, the green-field BC-creation carve-out, and the obvious-resolution criterion all behaved as intended in both runs. These are not revisited below.

## 2. Findings, by severity

### CRITICAL — diff baseline is conceptually wrong (iteration §3.0)

`SKILL.md §4` and `design-doc-schema.md §3` both define the diff baseline as the **prior Design Doc record**. The correct baseline is the **currently implemented codebase** — what `noesis:implement-design-doc` will read as the starting state. For an unimplemented BC, every item belongs in `added`, even when a prior design doc record listed it; `modified`/`removed` should stay empty until implementation has happened. The iteration run produced a saved doc with 12 `modified` + 11 `removed` items that should all have been in `added` against an empty implementation baseline; the implementer would now look for code that has never existed.

This is the foundational fix. Several other findings in the iteration review (self-introduced rename contradictions, "renames are heavy-weight", "behaviour rename mechanism missing", "property rename mechanism missing") become **structurally impossible for unimplemented designs** once the baseline is correct, and only re-emerge in true post-implementation iterations.

### HIGH — interchangeable Building Blocks have no first-class modelling mechanism (green-field §3.1)

`CompositeComponent.children` is a list of *either* `CompositeComponent` *or* `SimpleComponent`. The schema's `DesignedProperty.type` is a single string. The green-field run worked around this by omitting `type` and describing the heterogeneity in prose — leaking structural intent out of the schema. Tree structures, polymorphic collections and DDD `Specification` predicates that compose via `and`/`or`/`not` will all hit this.

The fix is OOP-shaped, not union-shaped: when two or more BBs need to be interchangeable in some context, introduce an explicit **base Building Block** that models the common abstraction. Implementing BBs declare an `implements: string[]` collection naming the base BBs. Property types then reference the base BB by name. No union-type syntax in `type`; the polymorphism is modelled, not encoded.

### MEDIUM — workflow gaps surfaced by both runs

| # | Finding | Source |
|---|---|---|
| M1 | Properties cannot carry `description`, `nullable`, or `collection` — every such note is forced into surrounding prose. | green-field §3.2 |
| M2 | "Attach scenario to its Rule" is literally impossible — `DesignedRule` has no `scenarios` field. | green-field §3.3 |
| M3 | Setup is silent on "neither `design_doc_id` nor `design_doc_title` supplied". | green-field §3.4 |
| M4 | A Rule can be drafted at *both* a BB level and a Behaviour level; reconciliation is left to agent discipline. | green-field §3.5 |
| M5 | `<working_dir>` basename was derived from `design_doc_title` slug instead of the existing `design_doc_path` basename → name drift between JSON and analysis dir. | iteration §3.2 |
| M6 | `§1.5 read_model_for_modules` duplicates `§1.0 read_design_doc` when the only in-scope BC is the doc's own BC. | iteration §3.3 |
| M7 | First save rejected by 9 length errors — the validator becomes the de-facto linter. A pre-save length pass would catch them locally. | iteration §3.4 |
| M8 | Mermaid warnings in auto-mode trigger an `AskUserQuestion`; agents should embed by default when source diagrams exist in the input. | iteration §3.5 |
| M9 | Single input file >25K tokens forced three chunked `Read` calls — skill text doesn't address large-file ergonomics. | iteration §3.6 |

### LOW — polish items

| # | Finding | Source |
|---|---|---|
| L1 | Auto-mode policy across mandatory `AskUserQuestion` gates is implicit. | green-field §3.6 |
| L2 | Empty `ChangeSet` boilerplate (`{added:[],modified:[],removed:[]}`) bloats the JSON. | green-field §3.7 |
| L3 | Deferred MCP tool preloading is done in three batches; could be one. | green-field §3.8 |
| L4 | Polish/English input — no language-normalisation note in the skill. | green-field §3.9 |
| L5 | Local `python3 -c "import json; json.load(...)"` syntax pre-check is undocumented. | green-field §3.10 |
| L6 | Mermaid-in-JSON `\n`-escaping has no example in the schema reference. | green-field §3.11 |
| L7 | Setup token-form table is brittle to natural-language phrasings (`and conversations: <id>, <id>`). | iteration §3.7 |
| L8 | `TaskCreate` usage for long runs is implicit — only the harness reminded the agent. | iteration §3.11 |

---

## 3. Implementation plan

Five waves, ordered by leverage. Wave 0 is foundational; Waves 1–2 are pure documentation; Wave 3 is the optional schema lift; Wave 4 is validator hardening.

### Wave 0 — Fix the diff baseline (CRITICAL)

- **0a. `SKILL.md §4` — replace the diff-baseline paragraph.** Diff against the **implemented codebase**, not the prior Design Doc record. For green-field designs (no `implement-design-doc` run yet) every item goes in `added`; `modified`/`removed` stay empty. For post-implementation iterations the diff is against code; the prior Design Doc record is a hint, not the system of record.
- **0b. `design-doc-schema.md §3` — replace the ChangeSet rules.** Bucket by asking "is this item already in code?": not in code → `added`; in code, definition unchanged → omit; in code, definition changed → `modified`; in code, no longer wanted → `removed`. Identity remains `name`. A rename of an item already in code is `removed`+`added`; a rename of an item not in code is just `added`.
- **0c. `SKILL.md §1.0a` — implementation-status determination.** New sub-step: determine whether the in-scope BC(s) have been implemented. Sources of evidence: (a) explicit user statement; (b) graph provenance; (c) the codebase if accessible. When unsure, ask via `AskUserQuestion`. The answer pins the diff baseline used in Step 4.
- **0d. Regenerate the iteration run's saved JSON.** `wycena-dokumentow.json` and the `ca6a6da8-…` graph record reflect the wrong baseline — re-author with everything in `added`.
- **0e. Audit other already-saved DesignDoc records** authored under the misframed semantics; regenerate the unimplemented ones.

### Wave 1 — `SKILL.md` text edits (additive, low risk)

Items map to findings in §2.

- **1.1** (M2) §3.4 — replace "Attach a scenario to its Rule…" with "Attach a scenario to the **same parent (BB or Behaviour)** as the Rule it directly verifies; attach to a Behaviour when it spans the whole use case; attach at Building Block level only when it spans multiple Behaviours."
- **1.2** (M4) §3.3 — append "A Rule attaches at **exactly one level** — choose either the BB (when it constrains shape/invariant) or the Behaviour (when it gates a single transition). Never both."
- **1.3** (M3) Setup — title fallback: when `design_doc_id` is absent and `design_doc_title` is not supplied, derive `design_doc_title` from the H1 of the first `file_paths` entry, falling back to the kebab-case file basename. Confirm via `AskUserQuestion` only when no `file_paths` entry exists or the derived title collides with an existing doc.
- **1.4** (L1, M8) Rules — auto-mode gates: only **Approval gates** (BC creation outside the green-field carve-out, BC-relation changes) are strictly blocking in auto-mode. Other `AskUserQuestion` calls may be replaced by reasonable defaults *only* when the default is explicitly stated in this skill (e.g. the title fallback). Mermaid warnings: when the input files already contain compatible sequence/class diagrams that can be adapted, embed without prompting.
- **1.5** (L4) Step 2 — language normalisation: if the input file is not in English, normalise terms and descriptions to English in analysis files and the design doc; preserve ubiquitous-language proper nouns verbatim.
- **1.6** (L2) Step 4 — empty ChangeSets may be omitted: when `added`, `modified`, `removed` are all empty for a given collection field, drop the field entirely.
- **1.7** (L5, M7) Step 4.0 — pre-save length & syntax pass: programmatically check (`python3 -c "import json,sys; d=json.load(open('<path>')); …"`) that every `added` Rule description is ≥80 chars and every `added` Behaviour description is ≥400 chars, and that the JSON parses. Fix in place; do not rely on the validator to bounce a save just for length.
- **1.8** (L3) Pre-flight — MCP tool preload: enumerate the eight `mcp__plugin_noesis_noesis-graph__*` tools plus `AskUserQuestion` and load them in **one** `ToolSearch` call up front.
- **1.9** (M6) §1.5 iteration short-circuit: when §1.0 ran and every entry in the §1.4 candidate list is `(this design doc's BC, …)`, skip §1.5; the §1.0 markdown is already the model.
- **1.10** (M5) Setup — basename rule clarified: `<working_dir>` is `<basename>.analysis/` where `<basename>` is the file basename of `design_doc_path` *without* `.json`. When iterating and the JSON file already exists, **prefer that file's basename** to the slug of the title.
- **1.11** (L7) Setup — soft token parsing: accept natural-language fall-throughs for `conversations:`/`docs:`/`Update <doc-name>` phrasings, in addition to the canonical token form.
- **1.12** (M8) §3.5/§3.6 — author mermaid early: when §3.5 identifies a Behaviour using ≥3 building blocks (or any `application_service` Behaviour), embed a mermaid sequence diagram in its description **at the analysis stage** — input files often already have one to adapt.
- **1.13** (M9) Step 2 — large-file chunking: when `file_paths` includes a file >~25K tokens (rule of thumb: >~5000 lines or >~150 KB), use `Read` with `offset`/`limit` chunks of ~500–600 lines.
- **1.14** (L8) Workflow header — TaskCreate hint: "For long runs, optionally use `TaskCreate` to track Steps 1–4; mark each completed before progressing."
- **1.15** (HIGH) Modelling guidance for interchangeable BBs: when a property's value, a collection's elements, or a behaviour's input/output can be **two or more interchangeable BBs**, introduce an explicit **base Building Block** that models the common abstraction (its description names the role and the shared shape). The interchangeable BBs declare `implements: ["<BaseBB>"]`. Property/input/output `type` references the base BB by name. Do **not** invent a phantom umbrella BB just to satisfy the schema; the base BB is a real domain concept.

### Wave 2 — `references/design-doc-schema.md` edits

- **2.1** (HIGH) Interchangeable Building Blocks — full section with the OOP rule above, including a `Component → CompositeComponent | SimpleComponent` worked example using `implements: ["Component"]` and `children: Component[]` (via `collection: true` once Wave 3 lands; via prose otherwise).
- **2.2** (L6) Mermaid-in-JSON encoding — one-line example: `"description": "...\n\n\`\`\`mermaid\nsequenceDiagram\n  ...\n\`\`\`"`.
- **2.3** Green-field iteration worked example — show a "second authoring pass on an unimplemented design doc" where a BB definition is materially refined but stays in `added`. This is the case the current text gets wrong.
- **2.4** Post-implementation rename guidance — `removed: ["OldName"]` + `added: [{name: "NewName", …}]` plus cross-reference cleanup. Make explicit this only applies once code exists.

### Wave 3 — Schema enrichment (optional, larger lift)

- **3.1** (HIGH) Extend `DesignedBuildingBlock` with `implements: string[]` (default `[]`). Each entry must resolve to another declared BB in the same doc or in the prior model. Replaces the "union types in `properties[].type`" idea — polymorphism is **modelled** rather than encoded in property strings. Backwards-compatible.
- **3.2** (M1) Extend `DesignedProperty`:
  ```ts
  DesignedProperty {
    name: string
    type?: string
    description?: string         // free-form per-property note
    nullable?: boolean           // default false
    collection?: boolean         // default false
  }
  ```
  Backwards-compatible. Removes the prose-stuffing pressure for `BreakdownNode.scope` value range, `BreakdownNode.emissionFactorUsed` nullability, `BreakdownNode.children` collection-ness, etc.

### Wave 4 — Validator changes (`design-docs.service.ts`)

- **4.1** (M4) Reject duplicate Rule names across attachment sites — a Rule.name appearing under both a BB and a Behaviour is an error.
- **4.2** (post-impl. defence-in-depth) Reject removed-but-referenced contradictions — walk every name in any nested `removed`; if any other field resolves to it, push to `errors`. Catches the post-implementation rename mistake at save time.
- **4.3** (Wave 3 prerequisite) Validate `implements` resolution — every entry must resolve to a declared BB; reject otherwise.
- **4.4** Optional: `validate_design_doc` MCP tool — same logic, no persistence. Useful for the Step 4.0 pre-save pass and for confirming diff coherence against the §1.0a baseline.

---

## 4. What was deliberately dropped

- **Implementation marker per item** (server tracks `implementedAt` per BB) — out of scope for this plan.
- **Multi-file emission for large markdown rendering tools** — out of scope; the chunked-read workaround in **1.13** is sufficient.
- **Union types in `properties[].type` (`"A | B"`)** — replaced by the OOP `implements` approach in Wave 1.15 + Wave 3.1.
- **`renamed: { from, to }` collection on `ChangeSet`** — renames in unimplemented designs don't exist (Wave 0), and post-implementation renames are uncommon enough that the existing `removed`+`added` pattern is acceptable.
- **Strict Minimum reload principle** — remains aspirational; cost of strict eviction outweighs the context-budget savings on runs of this size.
- **Forcing modules in iteration** when the existing flat structure exceeds 20 BBs — left to a future iteration explicitly asking for modularisation.

---

## 5. Test plan

After **Wave 0**, re-run on the iteration input. Expected:

- Saved JSON has every BB in `added`; `modified`/`removed` empty.
- Self-introduced rename contradictions become structurally impossible.
- JSON size grows slightly (full specs are larger than `modified` patches), but semantics are correct.

After **Wave 1**, re-run on the green-field input. Expected:

- `ToolSearch` calls drop from 3 to 1 (1.8).
- JSON file size drops by ~30–40% (1.6, empty ChangeSets removed).
- One save round-trip eliminated on iteration-style runs (1.7, length pass).
- Zero mid-run `AskUserQuestion` for mermaid acceptance (1.4 + 1.12).
- One `read_model_for_modules` call eliminated when single-BC (1.9).
- Working-dir name matches JSON basename (1.10).
- One fewer reconciliation in §3.6 (1.2).
- Heterogeneous collections modelled with an explicit base BB instead of an omitted `type` (1.15).

After **Wave 2**, no behavioural change — readers of the schema reference get the worked examples.

After **Wave 3**, the Component/CompositeComponent/SimpleComponent example becomes:

- `Component` BB: declares the shared abstraction.
- `CompositeComponent.implements: ["Component"]`, `SimpleComponent.implements: ["Component"]`.
- `CompositeComponent.children: { name: "children", type: "Component", collection: true }`.
- `BreakdownNode.scope: { name: "scope", type: "Integer", description: "1, 2, or 3" }`.
- `BreakdownNode.emissionFactorUsed: { …, nullable: true }`.

After **Wave 4**, the agent-side discipline of **1.2** and the post-implementation rename hygiene in **2.4** are enforced at save time.

---

## 6. Closing note

Wave 0 is the high-leverage next step — without it, every "iteration" run produces design docs that misrepresent the work needed by `implement-design-doc`. Wave 1 is mechanical and additive. Wave 2 is documentation. Wave 3 is the only domain decision in the plan: do we want richer property metadata and explicit polymorphism in the graph? The answer drives whether Wave 4 (validator) needs the matching enforcement or not.
