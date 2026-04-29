# Execution Review — `noesis:create-design-doc`

Run on **2026-04-28** against `specs/CarbonFootprint-draft.md` (a Polish/English HLD draft for a Footprint Calculation Engine). Green-field invocation: empty graph, single input file, auto-mode.

This review supplements the existing `SKILL_REVIEW.md` (which was substantively folded into the current `SKILL.md`). It (1) confirms which prior recommendations now work in practice, (2) flags issues the prior review did not catch, and (3) proposes concrete edits.

---

## 1. Summary of execution

- **Duration & shape.** ~25 tool turns end-to-end, dominated by analysis-file `Write` calls. Save returned `status: "Ok"` with **zero warnings** on the first attempt.
- **Custom scripts.** One: a Python one-liner (`python3 -c "import json; json.load(open(...))"`) used to pre-validate JSON syntax before `save_design_doc`. Defensive — not strictly required because `save_design_doc` would also catch a malformed JSON. Cost: ~zero. See §3.7.
- **No errors.** No tool failures, no `save_design_doc` rejections, no warning loop.
- **Final artefact.** 46 KB JSON, 35 KB scratch markdown across 7 files. Output: 1 BC (`FootprintCalculation`) → 3 modules → 16 building blocks, 7 behaviours, 10 rules, 5 scenarios, 3 quality attributes, 1 actor.

## 2. What the prior review fixed and that this run validates

These items were called out in `SKILL_REVIEW.md` and the current `SKILL.md` already implements the fix. This run confirms the fix works:

| Prior review item | How this run validates |
|---|---|
| 1.1 Step 1 fires four MCP round-trips | Green-field short-circuit fired correctly: `§1.1`, `§1.2`, `§1.5` skipped, `§1.4` had no candidate list, only `§1.3` ran. Saved 3 MCP calls. |
| 1.2 Sequential references | Pre-flight read all 5 references in one `Read` batch (also batched the input draft). |
| 1.3 No parallelisation §3.2-3.5 | The four analysis files were emitted in one parallel `Write` batch. |
| 1.5 Schema reference loaded too late | Schema constraints (≥80 / ≥400 char minima, mermaid for ≥3 BBs, BB-name-only signatures) were observed during analysis — no rework at JSON-build time. |
| 2.1 Primitive-typed inputs/outputs | The "smallest VO that owns the primitive" rule drove the introduction of `FootprintAmount`, `Quantity`, `EmissionRate`, `FactorLookupKey`. Calculator output never collapsed to a raw `BigDecimal`. |
| 2.2 Phantom property types | Self-check at end of `analysis-model.md` and again in §4 caught no phantoms. |
| 2.3 No qualities sub-step | §3.7 produced 3 cross-cutting QAs and explicitly rejected 5 candidates as "already a Rule" — the guard worked. |
| 2.5 Tabular input rubric | The 13-row "Component Tree" table was correctly classified as runtime data of one aggregate, not as 13 separate BBs. Without the rubric the agent would likely have promoted every row to a BB and tripped the >20-BB warning. |
| 2.6 Use case / Behaviour / app-service conflation | Two public Behaviours (`CalculateFootprintTotal`, `CalculateFootprintUnit`) were grouped under one `application_service` (`FootprintFacade`) — no fragmentation. |
| 2.7 Working-dir lifetime | `<basename>.analysis/` created and not committed. Aligns with new Setup paragraph. |
| 3.1 BC-creation gate paradox | Green-field carve-out resolved the gate cleanly without prompting the user. |
| 3.6 "Obvious resolution" criterion | Two reconciliations (R3/R10 attachment, FootprintAmount uniformisation) were applied directly because each was supported by an explicit text in the analysis files; recorded under a `## Resolutions` heading. |
| 4.10 Read-modify-write protocol | Not exercised this run (no §3.3 ↔ §3.4 ping-pong needed). |
| 4.11 "Where to note resolutions" | `## Resolutions` heading appended to `analysis-model.md`. |
| 4.13 `*.analysis/` lifetime | Honoured. |

The prior review's recommendations have largely landed and they materially shaped the run's smoothness.

## 3. NEW findings from this execution

### 3.1 Heterogeneous-collection property types have no schema mechanism (HIGH)

**What happened.** `CompositeComponent.children` is a list of *either* `CompositeComponent` *or* `SimpleComponent`. The schema's `DesignedProperty.type` is a single `string` (a Building Block name or primitive). There is no union-type, no list marker, no abstract-supertype concept.

**Workaround used.** Omitted `type` and described the heterogeneity in a body note. The schema permits this because `type` is `?`-optional, but it leaks structural intent out of the schema.

**Recurring pattern.** Tree structures, polymorphic collections, and DDD `Specification` predicates that compose via `and`/`or`/`not` will all hit this. It will appear in many designs.

**Proposed fix (skill-level, no schema change).** Add to `references/design-doc-schema.md` §4 *Naming conventions* (or a new §7 *Modelling conventions*):
> **Heterogeneous collections.** When a property's value is a collection of two or more BB types with no shared declared supertype, omit `type` on that property and document the union in the parent BB's `description`. Do not invent a phantom umbrella BB just to satisfy the schema.

**Proposed fix (schema-level, optional).** Allow `properties[].type` to accept a `|`-delimited union string (`"CompositeComponent | SimpleComponent"`) and have `save_design_doc` resolve each leg against declared BBs. Cost: a small parser change in the validator; benefit: structural intent stays in the schema.

### 3.2 Properties cannot carry nullability, collection, or descriptive notes (MEDIUM)

`DesignedProperty = { name; type? }`. Every other piece of information (nullable, list, range, format, "null on composites") was forced into surrounding prose: BB description, behaviour description, or working-dir markdown that does not survive into the graph.

**Examples from this run.**
- `BreakdownNode.scope` — `Integer` value range is `{1, 2, 3}`. The constraint lives only in the rule `SimpleComponentScopeIsOneTwoOrThree`, not on the property itself.
- `BreakdownNode.emissionFactorUsed` — null on composite nodes, set on leaves. Not expressible in property structure.
- `BreakdownNode.children` — collection. Not expressible.

**Proposed fix (schema-level).** Extend `DesignedProperty` to:
```ts
DesignedProperty {
  name: string
  type?: string
  description?: string         // free-form per-property note
  nullable?: boolean           // default false
  collection?: boolean         // default false
}
```
- Backwards-compatible (all new fields optional).
- Removes the workaround pressure of stuffing structural notes into BB descriptions.
- Lets `save_design_doc` enforce nullability at validation time later.

### 3.3 "Attach scenario to its Rule" — instruction-vs-schema mismatch (MEDIUM)

`SKILL.md §3.4` says:
> Attach a scenario to its Rule when it directly verifies one Rule; attach to a Behaviour when it spans the whole use case…

The schema places `scenarios` only on `DesignedBuildingBlock` and `DesignedBehaviour` — `DesignedRule` has no `scenarios` field. So "attach to Rule" is literally impossible; an agent has to translate it into "attach to the parent of the Rule (which is a BB or Behaviour)."

This run inferred the right semantics, but a less careful agent will write `rules.scenarios = […]` and trip a schema-rejection round-trip.

**Proposed fix (skill text, `SKILL.md §3.4`).** Replace the first sentence with:
> Attach a scenario to the **same parent (BB or Behaviour)** as the Rule it directly verifies; attach to a Behaviour when it spans the whole use case; attach at Building Block level only when it spans multiple Behaviours.

### 3.4 Setup is silent on "neither id nor title supplied" (MEDIUM)

`SKILL.md` Setup states:
- "If both are supplied, ask via `AskUserQuestion`."
- "If all three [source lists] are empty, ask via `AskUserQuestion`."

It does **not** specify what to do when neither `design_doc_id` nor `design_doc_title` is supplied (and at least one source is). In auto-mode the agent must either:
- ask the user (jarring in auto-mode), or
- derive a title from the input.

This run derived `Footprint Calculation Engine` from the draft's H1 — but the rule was implicit. A different agent might pick `Carbon Footprint`, the file basename, or fail.

**Proposed fix (`SKILL.md` Setup).** Add a bullet:
> **Title fallback.** When `design_doc_id` is absent and `design_doc_title` is not supplied, derive `design_doc_title` from the dominant heading (`H1`) of the first `file_paths` entry, falling back to the kebab-case slug of the file basename. Confirm via `AskUserQuestion` only when no `file_paths` entry exists or the derived title collides with an existing doc.

### 3.5 Rule attachment is not constrained to one level (MEDIUM)

The agent (this run) drafted some rules at *both* a BB level and a Behaviour level — caught and reconciled in §3.6. The compile step caught it, but only because the agent is conscientious. Schema does not enforce uniqueness of a Rule across attachment sites; SKILL.md does not call this out.

**Examples this run.** `BreakdownTreeMirrorsComponentTree` (R3) and `EngineWritesNothing` (R10) initially appeared on both a BB and a Behaviour.

**Proposed fix (`SKILL.md §3.3`).** Append to the §3.3 instructions:
> A Rule attaches at **exactly one level** — choose either the BB (when it constrains shape/invariant) or the Behaviour (when it gates a single transition). Never both. If the rule applies to all behaviours of a service, attach it to the BB.

### 3.6 Auto-mode interaction with mandatory `AskUserQuestion` gates (LOW)

Several gates require `AskUserQuestion` (Approval, missing source, both id+title, non-obvious resolution, save warnings). In auto-mode the agent prefers not to interrupt. The agent must judge per gate.

This run faced one such gate (new BC introduction) and resolved it via the green-field carve-out — clean. But broader policy is still implicit.

**Proposed fix (Rules section).** Add a new bullet:
> **Auto-mode gates.** Only the **Approval gates** Rule (BC creation outside the green-field carve-out, BC-relation changes) is strictly blocking in auto-mode. Other `AskUserQuestion` calls (missing setup info, non-obvious resolution, warning acceptance) may be replaced by reasonable defaults *only* when the default is explicitly stated in this skill (e.g. the title fallback in §3.4). Otherwise, ask.

### 3.7 Empty `ChangeSet` boilerplate (LOW)

The schema marks the wrapper field `?`-optional but the JSON I produced has hundreds of lines of `{"added": [], "modified": [], "removed": []}` placeholders. They round-trip through `save_design_doc` harmlessly but make the JSON larger and noisier than it needs to be.

**Proposed fix (`SKILL.md` Step 4).** Append:
> **Empty ChangeSets may be omitted.** When `added`, `modified` and `removed` are all empty for a given collection field, drop the field entirely rather than emitting `{ "added": [], "modified": [], "removed": [] }`.

(Also worth confirming `save_design_doc` treats omitted fields and empty ChangeSets identically — current behaviour appears to.)

### 3.8 Pre-loading deferred MCP tools (LOW)

`SKILL.md` references several MCP tools by name (`list_design_docs`, `read_bounded_context_map`, `list_topic_summaries_for_sources`, `list_decisions_for_sources`, `read_design_doc`, `read_model_for_modules`, `list_topic_items_since`, `save_design_doc`) and the skill also implicitly needs `AskUserQuestion`. In a deferred-tools harness, each must be loaded via `ToolSearch` before first use.

This run loaded them in three batches as it went. Could have been one upfront batch.

**Proposed fix (`SKILL.md` Pre-flight reads).** Append after the references list:
> **MCP tool preload.** In a deferred-tool harness, the workflow needs the following tools — load them in one `ToolSearch` call up front: `mcp__plugin_noesis_noesis-graph__list_design_docs`, `…__read_bounded_context_map`, `…__list_topic_summaries_for_sources`, `…__list_decisions_for_sources`, `…__read_design_doc`, `…__read_model_for_modules`, `…__list_topic_items_since`, `…__save_design_doc`, plus `AskUserQuestion`.

### 3.9 No language-handling note (LOW)

The input draft mixed Polish and English. The agent normalised to English in the design doc. Skill is silent.

**Proposed fix (`SKILL.md` Step 2).** Add a one-liner:
> If the input file is not in English, normalise terms and descriptions to English in the analysis files and the design doc. Preserve ubiquitous-language tokens (e.g. proper nouns) verbatim.

### 3.10 `save_design_doc` syntax pre-check is undocumented (LOW)

A 50-KB JSON with deep nesting is easy to typo. A local `python3 -c "import json; json.load(...)"` is a 20 ms safety net before invoking the MCP tool. The skill could acknowledge this:

**Proposed fix (`SKILL.md` Step 4).** Append:
> Optional pre-check: run `python3 -c "import json; json.load(open('<path>'))"` to catch JSON syntax errors locally before the MCP round-trip.

### 3.11 Mermaid-in-description encoding is non-trivial in JSON (LOW)

Embedding a multi-line ` ```mermaid ` block inside a JSON string requires `\n`-escaping. Not hard, but easy to mis-author. No example in either `SKILL.md` or the schema reference.

**Proposed fix (`references/design-doc-schema.md`).** Add a one-line example:
> Mermaid blocks inside `description` fields use `\n`-separated lines: `"description": "...\n\n\`\`\`mermaid\nsequenceDiagram\n  ...\n\`\`\`"`.

---

## 4. Recommendations not adopted (and why)

The prior review noted the **Minimum reload principle** is hard to enforce (#3.3 of `SKILL_REVIEW.md`). This run did not enforce it strictly either — analysis files I had just written remained in active context for the rest of the run. The principle is aspirational. **Decision: leave as-is.** The cost of strict eviction (re-read tool calls) outweighs the context-budget savings on runs of this size. Revisit only if a future run blows the context window.

---

## 5. Implementation plan

Concrete edits, in priority order. None require code changes; #3 is only a code change if you adopt the schema-level option.

### Wave 1 — `SKILL.md` text edits (no behavioural risk)

1. **§3.4 — Scenario attachment phrasing.** Replace "Attach a scenario to its Rule when it directly verifies one Rule" with the BB/Behaviour-parent wording in §3.3 above.
2. **§3.3 — Rule single-level attachment.** Append the "Rule attaches at exactly one level" sentence.
3. **Setup — Title fallback.** Add the H1-derived title rule.
4. **Rules — Auto-mode gates.** Add the new bullet on which gates remain blocking.
5. **Step 2 — Language normalisation.** One-liner.
6. **Step 4 — Empty ChangeSet drop.** One-liner.
7. **Step 4 — JSON syntax pre-check.** One-liner.
8. **Pre-flight — MCP tool preload list.** Single bullet enumerating the tools.

These are all additive, ≤ a few lines each, and clearly scoped.

### Wave 2 — `references/design-doc-schema.md` text edits

9. **Heterogeneous collections paragraph.** Add modelling guidance for tree/polymorphic collections.
10. **Mermaid-in-JSON encoding example.** One-line example.

### Wave 3 — Schema enrichment (optional, larger lift)

11. **Extend `DesignedProperty`** with `description?`, `nullable?`, `collection?`. Backwards-compatible. Update both the TypeScript schema in `shared-contracts/design-doc.ts` and the validator. Update `references/design-doc-schema.md`. Removes pressure on items 3.1 and 3.2.
12. **Allow union types in `properties[].type`** (`"A | B"`). Requires a small parser change in the validator that splits on `|` and resolves each leg. Removes the omit-`type` workaround for heterogeneous collections.

Wave 3 is a domain decision (do we want richer property metadata in the graph?). Wave 1 + Wave 2 are pure documentation and produce immediate quality gains for the next agent run.

### Wave 4 — Validation tightening (optional, requires the validator)

13. **Reject duplicate Rule names across attachment sites** in `save_design_doc`. Today an agent can attach the same `Rule.name` at both BB and Behaviour level and the save accepts both. A simple uniqueness check at save time would automate the human discipline that §3.6 currently enforces by hand.

---

## 6. Test plan for the proposed edits

After applying Wave 1+2, re-run the skill against the same input draft. Expected diff vs the 2026-04-28 run:

- ToolSearch calls drop from 3 to 1 (Wave 1 #8).
- JSON file size drops by ~30-40% (Wave 1 #6 — empty ChangeSets removed).
- No behavioural change in the saved DesignDoc.
- One fewer judgement call by the agent at Setup (Wave 1 #3).
- One fewer reconciliation in §3.6 (Wave 1 #2 — agent prevented from dual-attaching rules in the first place).

If Wave 3 lands, also expect:

- `BreakdownNode.children` to gain `"collection": true` and `BreakdownNode.scope` to gain a `description` field.
- `CompositeComponent.children.type` becomes `"CompositeComponent | SimpleComponent"` instead of being omitted.

---

## 7. Closing note

The skill is in a substantially better shape than `SKILL_REVIEW.md`'s baseline — most of its 30+ recommendations are already in `SKILL.md` and they materially shaped the smoothness of this run. The remaining gaps are narrower and closer to the schema layer than to the workflow layer. Wave 1 alone is a low-risk, high-leverage next iteration.
