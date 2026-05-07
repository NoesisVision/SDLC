# Noesis plugin — design rules

Layered on `src/agent_extensions/CLAUDE.md` and `SDLC/CLAUDE.md`. Only the noesis-specific delta is captured here.

## Models

- **Skill output**: each skill has a `{SkillName}Output` Zod schema at `shared-contracts/skills/<skill>/output.ts`. Skills that build a result incrementally persist it as `<working_dir>/output.json` and edit it in place across steps.
- **UI read models**: each view (page or independently-loaded section) has its own contract type. Define one type per view shaped to exactly what the screen needs; assemble it server-side so the UI does one fetch per view when possible.
- **UI contract location**: per-view contracts live at `mcp/<package>/ui-contracts/<view>/<view>-data.ts` and are imported directly by both the backend service and the UI (the UI's `tsconfig.json` includes `../ui-contracts` so types are not duplicated). No separate "ui-data" layer.
- **Shared contracts**: top-level `shared-contracts/` holds cross-skill, cross-domain models grouped by domain; `shared-contracts/skills/<skill>/` holds skill-specific output and helpers. Reuse a top-level model whenever it fits as-is.
- **Type minimalism**: prefer passing a bit too much data over introducing a new type. Aliases and structural shapes beat fresh interfaces when the shape already exists.

## Architecture

- **Repositories**: granular DB ops only (`exists`, `insertX`, `linkX`, `listXForY`, `updateXFields`). Used **only by services** — never from MCP handlers, controllers, or other repositories.
- **Services**: orchestrate use cases AND assemble UI view models. They read + validate input, call the repositories they need (own-domain plus same-graph cross-domain when the view requires it), and shape rows into the contract type the view expects. The only callers of repositories.
- **HTTP controllers**: live in the same domain dir as their service (`<domain>/<domain>.controller.ts`), registered in that domain's NestJS module. Thin — parse args, call a service method, return the result. No separate UI-data layer of controllers or services.
- **MCP tools**: thin too — parse args, call a service method, shape the response.
- **One step → one struct → one MCP tool**: each workflow step gets a single dedicated structure returned by a single tool. Avoid chatty round-trips.
- **Minimal returns**: return only what the agent or UI needs next. `{ status: "Ok" }` or `{ id }` is fine; per-slot breakdowns usually aren't.

## Boundaries

- **No LLM in the MCP server**: `noesis-graph` has no Anthropic API access. All semantic reasoning (Goldilocks topic search, summarisation, decision/design extraction) happens in the agent driving the skill. The server provides deterministic data access only.

## Testing

- **Never run `bun test` for the whole noesis plugin.** Bun segfaults when more than one test file initialises/closes the `lbug` (Kuzu fork) native binding in the same process. Single-file runs (`bun test path/to/x.test.ts`) are fine.
- **Use the wrapper to run the full suite**: `bun run scripts/run-tests.ts` from `src/agent_extensions/plugins/noesis/`. It executes each `*.test.ts` in its own Bun subprocess and aggregates results.

## File-first persistence

- **Source of truth lives on disk** under `<projectDir>/noesis/`:
  - `conversations/<conversation_id>.{md,json}` — cleaned transcript (md) + sidecar (turns/idea_units).
  - `documents/<document_id>.{md,json}` — source markdown + sidecar (fragments + section tree).
  - `topics/<topic_id>.json` — flat topic file with `parent_id`, items carry `source_sha`.
  - `decisions/<decision_id>.json` — decision file with `topic_id`, referenced items carry `source_sha`.
  - `design-docs/<design_doc_id>.json` — design doc.
- The graph DB is a **cache rebuilt from these files**. Skills produce the same output they always have; the MCP server splits that output into the canonical files (in `mcp/noesis-graph/file-sync/`) on `merge_conversation` / `merge_document` / `save_design_doc`.
- **Every json file carries `edited_by_user: boolean`**. Splitter writes `false` on every skill-driven write. The indexer flips it to `true` when it sees on-disk content drift it didn't drive (and patches the file in place). When `true`, the splitter skips the file on the next merge — the user's content wins until they reset the flag.
- **Cross-file references store `source_sha`** (sha-256 of the referenced file at ref-creation time). Mismatches are how the indexer detects stale dependents.
- **Indexer + file sync**: `mcp/noesis-graph/indexer/` boots on `OnApplicationBootstrap`, scans `<projectDir>/noesis/`, and watches it afterwards. The split:
  - `IndexerService` owns the index state (`indexing` / `consistent` / `error`), drives `runFullIndex`, and is the single registry mutator (deletes vanished registry rows by calling `FileSyncService.removeFile`).
  - `FileSyncService` handles a single file: detects kind/id, computes its sha, upserts the `SourceFile` registry row, and detects user edits (registry-sha vs on-disk-sha drift → flips `edited_by_user=true` and stamps the file). It delegates per-kind DB upserts to `GraphProjectionService`.
  - `GraphProjectionService` owns all per-kind Cypher (Conversation / Document / Topic / Decision / DesignDoc).
  - `StalenessService` walks topics/decisions after each pass and recomputes `is_stale` from cross-ref `source_sha` vs current `SourceFile.sha`.
  - `FileWatcherService` runs the initial index on bootstrap, then watches `<projectDir>/noesis/` with a 1-second debounce, single-flight re-indexing (concurrent triggers are coalesced into one re-run after the current one finishes), and an extending debounce window when bursts arrive (e.g. `git checkout`).
  The merge tools call `splitter` then `fileSync.registerWritten` for every produced path, so the watcher's later event matches the registry and is recognised as a skill write rather than a user edit. State is exposed at `GET /api/health/index` and rendered in the UI header.
- **Conversation IDs are content-addressed**: derived from a sha-256 of the source transcript. Same source → same id across reruns; no legacy `<source>-cleaned.md` file is required for id stability.
- **Write gate**: every write MCP tool wraps its call in `indexer.gateWrite(…)` so writes return `{ status: "NotReady" }` only after a 1-second retry confirms the indexer is still busy. Read tools are never gated.
