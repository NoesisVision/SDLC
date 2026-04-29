---
name: noesis:implement-design-doc
description: Turn a Design Doc (JSON diff of added / modified / removed items) into running C# code. Lays out Bounded Context and Module projects, schedules Building Block implementation in dependency-ordered batches via per-type subagents, plugs in adapters for domain ports, and verifies the result by build + test.
---

# Implement Design Doc

The main agent is the **coordinator**. It reads the Design Doc, lays out the project skeleton, plans batches, dispatches subagents, and runs the build. Per-type implementation knowledge (how to write an aggregate, an application service, a repository adapter, …) lives in `references/` and is loaded **only by subagents** — never by the coordinator.

A Design Doc is a **diff** (`added` / `modified` / `removed` per ChangeSet). Every change in the diff must be implemented; nothing outside the diff may be touched. When the diff cannot be implemented as written — missing information, contradictory references, an item that can't be expressed in the target language — stop and ask the user via `AskUserQuestion`.

## Pre-flight reads

Before Setup, load this reference in a single `Read` call and keep it in active context for Step 2:

- `${CLAUDE_PLUGIN_ROOT}/skills/implement-design-doc/references/modules.md` (governs Step 2 — BC + Module project layout, dependencies, naming)

All other references in `${CLAUDE_PLUGIN_ROOT}/skills/implement-design-doc/references/` are loaded by subagents at Step 4 and Step 5. The coordinator never reads them.

## Setup

Parse arguments from `$ARGUMENTS`. Required:

| Token form | Routes to |
|---|---|
| `@<path>` or bare path | `design_doc_path` |
| `solution:<path>` | `solution_root` |

- **design_doc_path** — absolute path to the Design Doc JSON produced by `noesis:create-design-doc`.
- **solution_root** — absolute path to the C# solution root (the directory containing the `.sln` and the per-BC project folders). Ask via `AskUserQuestion` if missing.

Pick a `<working_dir>` for coordinator scratch files: a sibling of `design_doc_path` named `<basename>.implementation/`. Create it with `Bash`. **Lifetime:** scratch — never committed.

## Workflow

### Step 1: Load the Design Doc

Read `<design_doc_path>` once. Extract a flat working view into `<working_dir>/changes.md`:

- **Bounded Contexts**: name, change kind (`added` / `modified` / `removed`), description.
- **Modules** per BC: name, change kind, parent path.
- **Building Blocks** per (BC, Module): name, type, change kind, target file path (resolved from BC + Module + name).
- **Behaviours / Rules / Scenarios / Properties** per BB: nested change kinds.

This file is the single source of truth for Steps 2-5. Re-read it whenever you need to look something up — do not keep the parsed Design Doc resident in active context.

If the Design Doc is empty (no `added` / `modified` / `removed` items anywhere), stop and tell the user there is nothing to implement.

### Step 2: Lay out Bounded Contexts and Modules

Apply the BC + Module changes from `<working_dir>/changes.md`. Use `modules.md` (loaded in Pre-flight reads) for the project layout, naming, and inter-project dependency rules.

For each BC:
- `added` → create a new C# project under `<solution_root>` and register it in the solution. Set its project references per `modules.md`.
- `modified` → adjust project references only when the diff actually changes BC-level relations; never touch internals here.
- `removed` → **confirmation gate**. Ask via `AskUserQuestion` before removing the project; deletion is destructive.

For each Module within a BC:
- `added` → create the module directory under the BC project (nesting reflects the module path).
- `modified` → no structural change at this step; module-internal edits happen in Step 4.
- `removed` → confirmation gate, same as BC removal.

After this step, every BC and Module declared by the diff exists on disk and the solution builds (empty projects compile). Run a quick `dotnet build` to confirm before proceeding.

### Step 3: Plan Building Block batches

Read `<working_dir>/changes.md`. Build the dependency graph over Building Blocks in scope (every `added` and `modified` BB):

- A BB depends on every other BB it references — `properties[].type`, `behaviours[].input` / `output` / `usedBuildingBlocks`.
- Cross-BC references count.
- `removed` BBs do not enter the graph; they are deleted at the start of Step 4.

Topologically split the graph into **batches**. Within a batch, BBs are independent (no edges between them). Each subsequent batch depends only on BBs that exist in earlier batches or were already in the codebase before this run.

Within each batch, group BBs by **type**: `aggregate`, `entity`, `value_object`, `domain_event`, `domain_command`, `domain_query`, `domain_service`, `application_service`, `factory`, `repository`, `external_integration`. For `repository` and `external_integration`, Step 4 produces the **port** (the interface that lives in the domain layer); Step 5 adds the adapter that implements it.

Write the plan to `<working_dir>/batches.md`:

```
Batch 1
  value_object
    - <BC>/<Module>/<Name>
    - ...
  entity
    - ...
Batch 2
  aggregate
    - ...
  ...
```

### Step 4: Implement Building Blocks (per batch, per type)

Process batches **sequentially** (a later batch depends on earlier ones). Within a batch, process type-groups **in parallel** by dispatching one subagent per type-group via the `Agent` tool.

Before dispatching the first batch, perform `removed` deletions: for every BB / Behaviour / Rule / Scenario / Property marked `removed` in `<working_dir>/changes.md`, delete the corresponding code (and any test that targets it). These deletions are confirmation-gated only at the BB level and above; sub-BB removals (a property gone from an aggregate) are routine and do not need confirmation.

Each subagent prompt MUST include:

- The exact Building Block slice to implement (names, types, properties, behaviours, rules, scenarios — read from `<working_dir>/changes.md`).
- The target file paths (one per BB).
- Instruction to **read only one reference**, picked from this type → file mapping:

  | BB type | Reference file |
  |---|---|
  | `aggregate` | `aggregates.md` |
  | `entity` | `entities.md` |
  | `value_object` | `value-objects.md` |
  | `domain_event` | `domain-events.md` |
  | `domain_command` | `domain-commands.md` |
  | `domain_query` | `domain-queries.md` |
  | `domain_service` | `domain-services.md` |
  | `application_service` | `application-services.md` |
  | `factory` | `factories.md` |
  | `repository` | `repositories.md` (port only — adapter is Step 5) |
  | `external_integration` | `external-integrations.md` (port only — adapter is Step 5) |

  Path: `${CLAUDE_PLUGIN_ROOT}/skills/implement-design-doc/references/<file>`.
- Instruction to read `${CLAUDE_PLUGIN_ROOT}/skills/implement-design-doc/references/business-scenarios.md` when the slice contains any `Rule` or `Scenario` — every Rule and Scenario from the design doc must materialise as a business-scenario test at the level the doc specifies (Behaviour or Building Block).
- Reminder that the Design Doc is authoritative: implement exactly what is in the slice, no extra fields, no extra behaviours.
- Instruction to return a short report: files written, files modified, tests added.

The coordinator collects subagent reports per batch. If any subagent reports an unimplementable item, stop the batch and escalate via `AskUserQuestion` — do not let the next batch start on an inconsistent base.

### Step 5: Implement adapters for domain ports

For every `repository` and `external_integration` BB in the diff, Step 4 produced the port interface in the domain layer. Step 5 adds the adapter — the infrastructure-side implementation that satisfies that interface.

Group adapters by **port type**: one group for repositories, one for external integrations. Dispatch one subagent per group via the `Agent` tool, in parallel.

Each subagent prompt MUST include:

- The list of ports to adapt (BB names and target adapter file paths).
- Instruction to **read only one reference**: `${CLAUDE_PLUGIN_ROOT}/skills/implement-design-doc/references/<port>-adapters.md` (`repository-adapters.md` or `external-integration-adapters.md`).
- A short report on completion (files written, integration tests added if applicable).

### Step 6: Build and test

Run `dotnet build <solution_root>`. If it fails:
- Read the failure, locate the offending file, fix it directly when the cause is mechanical (missing using, typo, accidental name collision).
- If the cause is a design-doc inconsistency (a BB references a name that doesn't exist anywhere), stop and `AskUserQuestion`.

Then run `dotnet test <solution_root>`. Apply the same triage: mechanical fixes inline, design-level questions to the user.

Report to the user:
- Counts of BCs / Modules / Building Blocks `added` / `modified` / `removed`.
- Build status, test status (pass / fail / total).
- Anything from `<working_dir>` that warrants follow-up (e.g. items the user resolved with deviations from the doc).

## Rules

- **Strict adherence to the diff.** Implement exactly what `added` / `modified` / `removed` say. Do not refactor neighbouring code, do not add fields the doc doesn't list, do not silently widen scope. Anything outside the diff stays untouched.
- **Ask before deviating.** If the diff cannot be implemented as written (missing info, contradictory references, language constraint), stop and `AskUserQuestion`. Never invent a workaround.
- **Confirmation gate for destructive structural changes.** Deleting a Bounded Context, a Module, or a Building Block requires explicit user confirmation via `AskUserQuestion`. Sub-BB deletions (properties, behaviours, rules, scenarios) are routine.
- **Coordinator never loads type-specific references.** Only `modules.md` lives in the coordinator. Every other file in `references/` is the responsibility of a subagent.
- **One reference per subagent.** Subagent prompts name a single reference path. This keeps subagent context narrow and prevents cross-contamination between BB types.
- **Rules are tested by business scenarios.** Every `Rule` in the diff produces at least one business-scenario test at the level the doc specifies (Behaviour or Building Block). A Rule with no scenario coverage after Step 4 is a bug — the responsible subagent must be re-dispatched, or the user consulted.
- **Scratch files only in `<working_dir>`.** Coordinator-side analysis (`changes.md`, `batches.md`, subagent reports) never leaves `<working_dir>`. Do not commit it.
