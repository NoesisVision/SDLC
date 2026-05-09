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
- The graph DB is a **cache rebuilt from these files**. Skills produce the same output they always have; each domain service splits that output into its canonical files inline (e.g. `conversations.uploadAnalysis`, `documents.merge`, `designDocs.persistFile`). There is no separate splitter or file-sync layer.
- **User edits are protected per-field via `*_locked` flags** (e.g. `title_locked`, `short_summary_locked`, `decision.text_locked`). The UI edit methods (`editFieldsAndLock`, `editTopFieldsAndLock`, `editAlternativeOptionAndLock`) set the lock when a field is changed. On the next skill-driven upload/merge, the service preserves any locked field instead of overwriting it; unlocked fields are replaced as usual.
- **Cross-file references store `source_sha`** (sha-256 of the referenced file at ref-creation time). Mismatches are how the indexer detects stale dependents.
- **Indexer**: `IndexerService` (`mcp/noesis-graph/indexer/indexer.service.ts`) owns index state (`idle` / `indexing` / `consistent` / `error`) and drives `runFullIndex`. A pass discovers source files under `<projectDir>/noesis/`, calls each domain service's `indexFile(path)` (which computes the file sha and upserts to the DB only when it differs from the stored sha), drops DB rows for vanished files via each domain's `deleteForFile(path)`, and finally calls `topics.refreshStaleFlags` / `decisions.refreshStaleFlags` to recompute `is_stale` from cross-ref `source_sha` vs current node sha. Concurrent calls coalesce: at most one pass runs and at most one follow-up is queued.
- **Per-domain services own projection**: each domain (`conversations` / `documents` / `topics` / `decisions` / `design-docs`) has its own `*.service.ts` + `*.repository.ts` pair. The repository holds the node sha (`c.sha`, `d.sha`, etc.) on the DB node directly — there is no separate `SourceFile` registry table. The service's `indexFile` is the single bridge from disk file → DB row.
- **File watcher (optional, opt-in)**: `IndexerServiceNew.startWatching()` watches `<projectDir>/noesis/` with a debounced re-index. It has no `OnApplicationBootstrap` hook — production code or tests that want filesystem-driven re-indexing must call `startWatching()` explicitly. Knowledge-domain tests deliberately leave it off so writes don't trigger async re-index events; only indexer-level tests turn the watcher on.
- **Conversation IDs are content-addressed**: derived from a sha-256 of the source transcript. Same source → same id across reruns.

## Dev seed coverage

`mcp/noesis-graph/dev/dev-seed.ts` owns the curated fixture set. Two coverage families must be preserved when the file-first models change (in `shared-contracts/source-file-schemas.ts`, `shared-contracts/design-doc-new.ts`, `shared-contracts/conversation.ts`, `shared-contracts/documents.ts`):

- **Optional / nullable shape coverage** — every optional or nullable field has at least one fixture with it `null` / omitted and one with it populated. The rich/minimal pair pattern is the convention (`actorRich()` / `actorMinimal()`, `salesBoundedContext()` / `reportingBoundedContext()`, etc.).
- **ChangeSet shape coverage** — every `{ added, modified, removed }` ChangeSet on `DesignDocFileNew` and its nested types has at least one fixture populating each slot. The greenfield doc (`greenfieldDesignDoc`) covers `added`; the tier-expansion doc (`tierExpansionDesignDoc`) covers `modified` + `removed` at every nesting level (bounded contexts, modules, building blocks, behaviours, rules, scenarios, quality attributes, properties, and string change-sets). When you introduce a new ChangeSet, extend `tierExpansionDesignDoc` so all three slots are non-empty somewhere.

When a model schema changes, update dev-seed in the same change. The general rule is in the SDLC root `CLAUDE.md` under "Dev seed coverage".
