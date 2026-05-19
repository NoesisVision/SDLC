---
name: noesis:implement-design-doc
description: Turn a Design Doc (diff of added / modified / removed items, retrieved from the noesis-graph MCP server by id or name) into running C# code in the current solution repository. Lays out Bounded Context and Module projects, schedules Building Block implementation in dependency-ordered batches dispatched to subagent groups (default per-type, merged when BBs are tightly coupled), plugs in adapters for domain ports, verifies the result by build + test, and finally compares a pre/post-implementation scan against the Design Doc (Bounded Contexts, Modules, Building Blocks, Behaviors) via a deterministic MCP tool, looping fixes until the implemented diff matches the doc exactly.
---

# Implement Design Doc

## Core principles

- The main agent is the **coordinator**. It reads the Design Doc, lays out the project skeleton, plans batches, dispatches subagents, and runs the build. Per-type implementation knowledge (how to write an aggregate, an application service, a repository adapter, …) lives in `references/` and is loaded **only by subagents** — never by the coordinator.
- A Design Doc is a **diff** (`added` / `modified` / `removed` per ChangeSet). Every change in the diff must be implemented; nothing outside the diff may be touched. When the diff cannot be implemented as written — missing information, contradictory references, an item that can't be expressed in the target language — stop and ask the user via `AskUserQuestion`.

## Pre-flight reads

Before Setup, load this reference in a single `Read` call and keep it in active context for Step 2:

- `${CLAUDE_PLUGIN_ROOT}/skills/implement-design-doc/references/modules.md` (governs Step 2 — BC + Module project layout, dependencies, naming)

All other references in `${CLAUDE_PLUGIN_ROOT}/skills/implement-design-doc/references/` are loaded by subagents at Step 4 and Step 5. The coordinator never reads them.

## Setup

The skill runs **inside the target solution repository**. The current working directory is the solution root — do not ask for a solution path.

Parse `$ARGUMENTS` for a single token: a Design Doc reference (id or name).

- If the token is a Design Doc id, use it directly.
- If the token is a name, call the `list_design_docs` MCP tool, locate the matching record, and use its id. If multiple match or none match, ask the user via `AskUserQuestion`.
- If the token is missing entirely, list design docs and ask the user to pick.

Resolve a `<working_dir>` for coordinator scratch files by running:

```
NOESIS_PROJECT_DIR=$(pwd) bun run ${CLAUDE_PLUGIN_ROOT}/scripts/resolve-working-dir.ts noesis:implement-design-doc <execution_id>
```

Use the resolved `design_doc_id` as `<execution_id>`. The script returns JSON `{ "status": "Ok", "working_dir": "...", "skill_name": "...", "execution_id": "..." }`. Treat `working_dir` as an opaque absolute path and use it verbatim for `batches.md` and any subagent reports. **Lifetime:** kept across runs for debugging; the skill never deletes it. The directory lives under the plugin's per-project tmp area outside the repository, so no `.gitignore` entry is required.

## Workflow

### Step 1: Load the Design Doc

Call the `read_design_doc` MCP tool with the resolved `design_doc_id`. The tool writes a deterministic Markdown rendering of the full diff (Bounded Contexts → Modules → Building Blocks → Behaviours / Rules / Scenarios / Properties, with `added` / `modified` / `removed` markers) to a tmp file and returns the file path. Read that file once, then re-read it whenever you need to look something up across Steps 2–5 — do not keep the parsed Design Doc resident in active context.

Do **not** create a coordinator-side re-shaping of the doc. Any alternative view (e.g. a flat list with resolved file paths) belongs in the MCP server as a deterministic tool, not in agent scratch.

If the Design Doc is empty (no `added` / `modified` / `removed` items anywhere), stop and tell the user there is nothing to implement.

### Step 2: Lay out Bounded Contexts and Modules

Apply the BC + Module changes from the design-doc Markdown produced in Step 1. Use `modules.md` (loaded in Pre-flight reads) for the project layout, naming, and inter-project dependency rules. The solution root is the current working directory.

For each BC:
- `added` → create a new C# project under the solution root and register it in the solution. Set its project references per `modules.md`.
- `modified` → adjust project references only when the diff actually changes BC-level relations; never touch internals here.
- `removed` → delete the project and remove it from the solution. The doc was approved at design time; no confirmation is required.

For each Module within a BC:
- `added` → create the module directory under the BC project (nesting reflects the module path).
- `modified` → no structural change at this step; module-internal edits happen in Step 4.
- `removed` → delete the module directory. No confirmation required.

After this step, every BC and Module declared by the diff exists on disk and the solution builds (empty projects compile). Run a quick `dotnet build` to confirm before proceeding.

### Step 3: Plan Building Block batches and subagent groups

Re-read the Step 1 Markdown. Build the dependency graph over Building Blocks in scope (every `added` and `modified` BB):

- A BB depends on every other BB it references — `properties[].type`, `behaviours[].input` / `output` / `usedBuildingBlocks`.
- Cross-BC references count.
- `removed` BBs do not enter the graph; they are deleted at the start of Step 4.

Topologically split the graph into **batches**. Within a batch, BBs are independent (no edges between them). Each subsequent batch depends only on BBs that exist in earlier batches or were already in the codebase before this run.

Within each batch, group BBs into **subagent groups**. Default grouping is by type (`aggregate`, `entity`, `value_object`, `domain_event`, `domain_command`, `domain_query`, `domain_service`, `application_service`, `factory`, `repository`, `external_integration`) — different types are usually independent and one type per subagent keeps the prompt narrow.

Deviate from per-type grouping when the BBs in a batch are tightly coupled across types (e.g. a domain event consumed by exactly one aggregate, an entity that only makes sense alongside its parent aggregate). In that case, place the coupled BBs in a **single subagent group** so one subagent implements them together. Step 3's job is to choose the split that minimises cross-subagent coordination — there is no rule that one subagent equals one type.

For `repository` and `external_integration` BBs, Step 4 produces the **port** (the interface in the domain layer); Step 5 adds the adapter that implements it.

Write the plan to `<working_dir>/batches.md`:

```
Batch 1
  Group 1 [value_object]
    - <BC>/<Module>/<Name>
    - ...
  Group 2 [entity, aggregate]   # grouped because Entity X is only used by Aggregate Y
    - ...
Batch 2
  Group 1 [aggregate]
    - ...
  ...
```

Each group is the unit of subagent dispatch in Step 4. Annotate each group with the BB types it contains and a one-line note when the grouping deviates from "one type per group".

### Step 4: Implement Building Blocks (per batch, per group)

Process batches **sequentially** (a later batch depends on earlier ones). Within a batch, process subagent groups **in parallel** by dispatching one subagent per group via the `Agent` tool.

Before dispatching the first batch, perform `removed` deletions: for every BB / Behaviour / Rule / Scenario / Property marked `removed` in the Step 1 Markdown, delete the corresponding code (and any test that targets it). The doc was approved at design time; deletions proceed without confirmation at any level.

Each subagent prompt MUST include:

- The exact Building Block slice to implement (names, types, properties, behaviours, rules, scenarios, quality attributes — taken from the Step 1 Markdown). Include every quality attribute attached at this BB or any of its behaviours, and (when the host BB is `application_service`) the `actor` declared on each behaviour.
- The target file paths (one per BB).
- Instruction to read **the references for every BB type in the group**, picked from the type → file mapping below. A group with a single BB type loads one reference; a mixed group loads one reference per type it contains. Keep groups small enough that the loaded reference set stays focused. Reference path: `${CLAUDE_PLUGIN_ROOT}/skills/implement-design-doc/references/<file>`.
- Instruction to read `${CLAUDE_PLUGIN_ROOT}/skills/implement-design-doc/references/business-scenarios.md` when the slice contains any `Rule` or `Scenario` — every Rule and Scenario from the design doc must materialise as a business-scenario test at the level the doc specifies (Behaviour or Building Block).
- Instruction to read `${CLAUDE_PLUGIN_ROOT}/skills/implement-design-doc/references/quality-attributes.md` when the slice contains any quality attribute. Quality attributes are technical concerns and must be materialised as the kind of artefact the reference specifies (test, configuration, code annotation, …) at the level the doc declares (Behaviour, Building Block, Module, or Bounded Context). They are processed analogously to Rules but with a technical, not domain, target.
- For every public Behaviour on an `application_service` host with `actor` set in the doc, instruct the subagent to apply `[Actor("<name>")]` to the C# method signature. The `compare_implementation_to_design` step in Step 7 verifies this annotation deterministically — a missing or mismatched actor annotation is a build-blocking comparator mismatch.
- Reminder that the Design Doc is authoritative: implement exactly what is in the slice, no extra fields, no extra behaviours.
- Instruction to return a short report: files written, files modified, tests added.

Type → reference mapping:

| BB type | Reference file |
| --- | --- |
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

The coordinator collects subagent reports per batch. If any subagent reports an unimplementable item, stop the batch and escalate via `AskUserQuestion` — do not let the next batch start on an inconsistent base.

### Step 5: Implement adapters for domain ports

For every `repository` and `external_integration` BB in the diff, Step 4 produced the port interface in the domain layer. Step 5 adds the adapter — the infrastructure-side implementation that satisfies that interface.

Group adapters by **port type**: one group for repositories, one for external integrations. Dispatch one subagent per group via the `Agent` tool, in parallel.

Each subagent prompt MUST include:

- The list of ports to adapt (BB names and target adapter file paths).
- Instruction to **read only one reference**: `${CLAUDE_PLUGIN_ROOT}/skills/implement-design-doc/references/<port>-adapters.md` (`repository-adapters.md` or `external-integration-adapters.md`).
- A short report on completion (files written, integration tests added if applicable).

### Step 6: Build and test

Run `dotnet build` from the solution root (the current working directory). If it fails:
- Read the failure, locate the offending file, fix it directly when the cause is mechanical (missing using, typo, accidental name collision).
- If the cause is a design-doc inconsistency (a BB references a name that doesn't exist anywhere), stop and `AskUserQuestion`.

Then run `dotnet test`. Apply the same triage: mechanical fixes inline, design-level questions to the user.

### Step 7: Verify the implementation against the Design Doc

The Design Doc is a diff. After Step 6, verify that the *actual* diff between pre-implementation and post-implementation state matches the doc — no missing changes, no extra changes — at the Bounded Context, Module, Building Block and Behavior levels. The comparator additionally verifies that every `application_service` behaviour with `actor` set in the doc carries the matching `[Actor("<name>")]` C# attribute on the post-implementation scan; a missing or mismatched actor is reported as a problem alongside structural mismatches. Rules, Scenarios, Properties, and Quality Attributes are NOT deterministically verified — they are owned by the Step 4 / Step 5 subagents (Rules → business-scenario tests; Quality Attributes → the artefacts described in `quality-attributes.md`).

The two MCP tools that drive this step are deterministic and produce/consume tmp artefacts only — they never write to the knowledge graph DB or to source files.

1. **Pre-implementation scan.** Before Step 4 starts, take a baseline snapshot. Call `scan_to_tmp` and store the returned path as `<working_dir>/before-scan.json` (copy the file into `<working_dir>` so it survives the tool-output GC). If `<working_dir>/before-scan.json` already exists from earlier in the *same* skill run and no source files have changed since, reuse it instead of rescanning. Otherwise rescan. **The pre-implementation scan must be taken before any code is written or deleted in Step 4.**
2. **Post-implementation scan.** After Step 6 succeeds, call `scan_to_tmp` again and copy the result to `<working_dir>/after-scan.json`. Do not skip this even if the build is green — a green build does not prove the diff matches the doc.
3. **Compare.** Call `compare_implementation_to_design` with `design_doc_id`, `before_scan_path = <working_dir>/before-scan.json`, `after_scan_path = <working_dir>/after-scan.json`. The tool returns either:
   - `{ status: "Ok", problems: [] }` — implementation matches the doc; the skill is finished.
   - `{ status: "Mismatch", problems: string[] }` — every entry is either a missing change (something the doc says should be there but isn't) or an unexpected change (something present in the implementation that the doc never declared).
4. **Fix-loop.** When `Mismatch` is returned, fix the listed problems directly in source (add the missing items, revert the unexpected ones). Do not edit the `before-scan.json` — the baseline must stay frozen. After fixes, re-run the build (Step 6), take a fresh post-implementation scan, and call `compare_implementation_to_design` again. Repeat until the comparator returns `Ok`. If a problem cannot be reconciled with the doc as written, stop and `AskUserQuestion`.

### Step 8: Seal the Design Doc as implemented

Once `compare_implementation_to_design` returned `{ status: "Ok" }` in Step 7 — and only then — call `noesis-graph:mark_design_doc_implemented` with the resolved `design_doc_id`. The tool flips `implemented: true` on the canonical JSON and the graph node, and from this point `save_design_doc`, `prepare_design_doc_path` (with this id), and the UI editor refuse to mutate the doc. If further changes are needed later, a new design doc must be created.

Do **not** mark the doc implemented if the comparator never reached `Ok`, or if the run was aborted via `AskUserQuestion` (unresolved deviations). The sealed flag means "the code under this solution matches this diff exactly"; mark only when that contract holds.

Report to the user:
- Counts of BCs / Modules / Building Blocks `added` / `modified` / `removed`.
- Build status, test status (pass / fail / total).
- Comparator status (`Ok` after the fix-loop converged) and the number of fix iterations.
- Confirmation that the design doc is now sealed as implemented.
- Anything from `<working_dir>` that warrants follow-up (e.g. items the user resolved with deviations from the doc).

## Rules

- **Strict adherence to the diff.** Implement exactly what `added` / `modified` / `removed` say. Do not refactor neighbouring code, do not add fields the doc doesn't list, do not silently widen scope. Anything outside the diff stays untouched.
- **Ask before deviating.** If the diff cannot be implemented as written (missing info, contradictory references, language constraint), stop and `AskUserQuestion`. Never invent a workaround.
- **No design-time confirmations during implementation.** The Design Doc was approved before this skill ran. Deletions at every level (BC, Module, Building Block, Behaviour, Rule, Scenario, Property) proceed without user confirmation. Confirmation gates are reserved for unimplementable items, not for executing the approved diff.
- **Coordinator never loads type-specific references.** Only `modules.md` lives in the coordinator. Every other file in `references/` is loaded by subagents at Step 4 / Step 5.
- **Subagent groups, not strict per-type splits.** Step 3 chooses the grouping. The default is one type per subagent group; tightly coupled BBs across types may share a group when that minimises coordination. A subagent loads one reference per BB type its group contains.
- **Rules are tested by business scenarios.** Every `Rule` in the diff produces at least one business-scenario test at the level the doc specifies (Behaviour or Building Block). A Rule with no scenario coverage after Step 4 is a bug — the responsible subagent must be re-dispatched, or the user consulted.
- **Scratch files only in `<working_dir>`.** Coordinator-side artefacts (`batches.md`, subagent reports, `before-scan.json`, `after-scan.json`) never leave `<working_dir>`. Do not commit them.
- **Verification gate is mandatory.** Step 7 (`compare_implementation_to_design`) must converge to `Ok` before the skill reports completion. A green build is necessary but not sufficient — the comparator catches missing or unintended structural changes the build cannot see. Comparator scope: Bounded Contexts, Modules, Building Blocks, Behaviors, plus actor annotations on `application_service` behaviours. Rules, Scenarios, Properties, and Quality Attributes are not verified deterministically and remain the responsibility of Step 4 / Step 5 subagents (`business-scenarios.md` for Rules / Scenarios; `quality-attributes.md` for Quality Attributes).
