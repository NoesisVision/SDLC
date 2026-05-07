# Review — Indexer / file-sync service cluster (2026-05-06)

Scope: `mcp/noesis-graph/file-sync/file-sync.service.ts`,
`mcp/noesis-graph/indexer/indexer.service.ts`,
`mcp/noesis-graph/indexer/file-watcher.service.ts`,
`mcp/noesis-graph/indexer/index-state.service.ts`,
`mcp/noesis-graph/indexer/write-gate.ts`.

## 1. Responsibilities, by component

### 1.1 `FileSyncService`
1. **Path classification** — `detect(absPath)` parses a path under `<projectDir>/noesis/` into `{ kind, id, ext }`, or returns `null` for paths that aren't source files.
2. **Per-file load + drift detection** — `loadFile(absPath)` computes the on-disk sha, compares to the registered sha, and:
   - If they drift, calls `handleUserEdit` which **patches the JSON file in place** to set `edited_by_user=true`.
   - Upserts the entity row in the graph DB (Conversation/Document/Topic/Decision/DesignDoc).
   - Upserts the `SourceFile` registry row.
3. **Acknowledging system writes** — `registerWritten(absPath)` does the same upsert work as `loadFile` but skips drift detection (the caller asserts authorship).
4. **Forgetting a file** — `removeFile(absPath)` deletes the registry row.
5. **Cross-file staleness sweep** — `refreshStaleFlags()` walks all topics + decisions, compares each cross-ref `source_sha` to the current registry sha, and stamps `is_stale` on the corresponding graph node.
6. **Per-kind graph projection** (private `upsert*` methods) — owns Cypher MERGE statements for **every** entity kind, plus delegation into `DesignDocsRepository.applyDesignDoc` for design-doc materialization.

### 1.2 `IndexerService`
1. **Discovery** — `discoverFiles()` walks the well-known noesis subdirectories (`conversations/`, `documents/`, `topics/`, `decisions/`, `design-docs/`) and yields `{ kind, path }` for every `.md`/`.json`.
2. **Full-pass orchestration** — `runFullIndex()` discovers, calls `fileSync.loadFile` for each path, garbage-collects vanished files, and calls `fileSync.refreshStaleFlags()` once at the end.
3. **State broadcasting** — drives `IndexStateService.beginIndexing → recordFileProcessed → markConsistent | markError` across the lifecycle.
4. **Garbage collection** — `removeVanished()` removes registry rows for files that disappeared between runs (talks **directly** to `SourceFilesRepository`, not through `FileSyncService`).
5. **Error trap** — wraps the whole pass in try/catch and translates exceptions into `markError`.

### 1.3 `FileWatcherService`
1. **Bootstrap-time initial index** — `onApplicationBootstrap()` calls `indexer.runFullIndex()` (when `autoStart` is true).
2. **Watch loop** — `start()` opens a recursive `fs.watch` on `<projectDir>/noesis/` and schedules a debounced re-index on each event.
3. **Debouncing** — collapses bursts into one `runFullIndex()` call after `debounceMs`.
4. **Lifecycle** — `stop()` clears the timer and closes the watcher; called from `onModuleDestroy`.
5. **Test-only knobs** — `disableAutoStart`, `setDebounceMs`.

### 1.4 `IndexStateService`
1. **Single in-memory state** — owns the `IndexState` snapshot (`state`, `files_total`, `files_processed`, `last_completed_at`, `last_error`, `stale_dependents`).
2. **Mutators** — `beginIndexing`, `recordFileProcessed`, `markConsistent`, `markError`, all called by `IndexerService`.
3. **Read API** — `get()` for the controller / write-gate, `isWriteAllowed()` for write tools.
4. **Pub/sub** — `subscribe(listener)` returning an unsubscribe function (used by SSE / UI broadcast paths).

### 1.5 `write-gate.ts` (free functions, not a service)
1. **`notReady(state)`** — formats a `{ status: "NotReady", message }` payload depending on whether the state phase is `indexing` or `error`.
2. **`gateWriteTool(state, fn)`** — runs `fn()` if `state.isWriteAllowed()`, otherwise returns `notReady(state)`. Wrapped around every write MCP tool.

## 2. Boundary analysis

### 2.1 Boundaries that are correct
- **`IndexStateService` ↔ everyone else**: clean. State is mutated only by `IndexerService`; read by the controller, write-gate, and any future SSE feed. No leaks.
- **`FileWatcherService` ↔ `IndexerService`**: clean. Watcher knows nothing about file kinds, registries, or graph DB; it just calls `runFullIndex`.
- **`write-gate` ↔ `IndexStateService`**: clean. `gateWriteTool` is pure logic over a single read method.

### 2.2 Boundaries that are wrong

#### **B1 — `FileSyncService` is two services in one**
It owns both **per-file sync** (loadFile, registerWritten, removeFile, drift detection) and a **global cross-file sweep** (`refreshStaleFlags`). Different invocation patterns, different reasoning model, different inputs. The sweep doesn't even need `FileSyncService`'s internal state; it could be a stand-alone collaborator using `SourceFilesRepository` and `DatabaseService` directly.

#### **B2 — `FileSyncService` is also the graph-projection layer for every entity kind**
The private `upsertConversationSidecar / upsertDocumentSidecar / upsertTopicFile / upsertDecisionFile / upsertDesignDocFile` methods carry **all** the per-domain Cypher knowledge plus a delegation to `DesignDocsRepository.applyDesignDoc`. This is a classic god-class: the file-sync layer now has to be edited every time a domain's row shape changes (e.g. a new column on `Topic`). Also makes `FileSyncService` the only piece of the system that imports schemas from every knowledge domain at once.

#### **B3 — `IndexerService.removeVanished` bypasses `FileSyncService`**
It calls `sourceFiles.remove(row.path)` directly, when `FileSyncService.removeFile(path)` already exists for exactly this case. The public surface of `FileSyncService` should be the only mutator of the registry; otherwise it's no longer the authoritative owner. (Currently `removeFile` returns the prior row, which `IndexerService` doesn't need — but the right move is to give the sync service the public contract and have `IndexerService` call it.)

#### **B4 — `FileWatcherService.start()` is never called in production**
`onApplicationBootstrap` runs `indexer.runFullIndex()` but does **not** call `this.start()`. The only callers of `start()` in the whole repo are the two test cases in `file-watcher.service.test.ts`. Net effect in production: the initial scan happens; subsequent on-disk changes during the session are **not** picked up. Either:
   - This is a real bug — bootstrap should also start the watcher; or
   - The watch loop is intentionally disabled and the bootstrap is the only entry point — in which case the `start/stop/debounce/scheduleReindex` machinery is dead code that should be removed.
Whichever it is, the current state is contradictory.

#### **B5 — `IndexerService` duplicates "what is a noesis source file"**
`IndexerService` keeps its own `KINDS` array, `VALID_EXTENSIONS` set, and uses `noesisSubdirPath` to walk the layout. Meanwhile `FileSyncService.detect` already encodes the same knowledge (subdir → kind, valid extensions). If a new subdir or kind is added, **two** places need updating in lockstep.

#### **B6 — `write-gate.ts` is the odd file out**
Free functions in a file without a `.service.ts` suffix, while every other piece of the cluster is a `*.service.ts`. Discoverability suffers — searching for "where do write tools become NotReady?" from `topics.mcp.ts` jumps to a free-function file with no class around it. Either keep the functional design but co-locate it with `IndexStateService` (since it's a 1-method client of that service), or wrap it in a thin `WriteGateService`.

## 3. Naming analysis

| Name                  | Verdict       | Notes |
|-----------------------|---------------|-------|
| `FileSyncService`     | OK            | Just renamed; reflects bidirectional reconciliation. Slightly understates the graph-projection role but no good shorter name covers everything (the right fix is to split, not to rename). |
| `IndexerService`      | Acceptable    | Reads as "the thing that drives indexing." Could be `FullIndexService` or `IndexOrchestrator` for precision, but `Indexer` is fine. |
| `IndexStateService`   | Good          | Exactly what it is. |
| `FileWatcherService`  | Misleading    | It's the **bootstrap trigger + watcher**, not just a watcher. If the bootstrap responsibility stays here, rename to `IndexerLifecycleService` or split (see §4). |
| `write-gate.ts`       | Inconsistent  | Convention everywhere else is `*.service.ts`. Either rename to `write-gate.helpers.ts` to make the "free functions" intent explicit, or convert to `WriteGateService`. |
| `gateWriteTool`       | OK            | Clear what it does. |
| `registerWritten`     | Awkward       | (Discussed separately.) `registerWrite` or `acknowledgeWrite` reads more naturally. |

## 4. Suggested redesign

### 4.1 Split `FileSyncService` (priority: high)

Three layers, three classes:

```
FileSyncService           (per-file, narrow)
  detect / loadFile / registerWritten / removeFile
  + drift detection + edited_by_user patching
  - delegates DB upserts to GraphProjectionService

GraphProjectionService    (per-kind upserts)
  upsertConversation(sidecar, sha, editedByUser)
  upsertDocument(sidecar, sha, editedByUser)
  upsertTopic(file, sha, editedByUser)
  upsertDecision(file, sha, editedByUser)
  upsertDesignDoc(doc, sha, editedByUser)

StalenessService          (cross-file sweep)
  refreshStaleFlags(): number
```

Why this split:
- `FileSyncService` becomes about disk ↔ registry + edit detection only — the responsibility its name actually advertises.
- `GraphProjectionService` is the single place where per-kind Cypher lives; new fields on `Topic` only touch one method.
- `StalenessService` is independently triggerable (e.g. a "rescan staleness" admin endpoint becomes trivial) and stops bloating the per-file path with global concerns.

### 4.2 Make `FileSyncService` the only registry mutator (priority: medium)

Remove `IndexerService.removeVanished`'s direct `sourceFiles.remove` call; replace with `await this.fileSync.removeFile(row.path)`. Keeps the registry's authoritative owner consistent.

### 4.3 Resolve the watcher contradiction (priority: high)

Either:
- **Option A — fix the bug.** In `FileWatcherService.onApplicationBootstrap`, after the initial `runFullIndex`, call `this.start()`. (And add a production-mode test that exercises a write-after-bootstrap path.)
- **Option B — delete dead code.** If the watch loop is intentionally off, remove `start / stop / scheduleReindex / debounceMs / disableAutoStart / fs.watch`, and rename the class to `IndexerBootstrapService` (only does the initial pass). Don't keep both halves around — pick one.

The current state (machinery exists but nothing wires it up in production) is the worst of both worlds.

### 4.4 Consolidate "what is a source file" (priority: low)

Move `KINDS`, `VALID_EXTENSIONS`, and the subdir → kind mapping to one place — preferably the existing `shared-contracts/source-files.ts`, which already exports `noesisSubdirPath` and the `SUBDIR_KIND` table that `FileSyncService.detect` uses internally. Have `IndexerService.discoverFiles` consume that single source of truth (or even better, ask `FileSyncService` for "all eligible files under projectDir").

### 4.5 Tighten the write-gate boundary (priority: low)

Two equally-good options:
1. **Co-locate.** Move `notReady` and `gateWriteTool` into `index-state.service.ts` as exported helpers — they're a 1-method client of that service and belong next to it.
2. **Wrap in a service.** `WriteGateService` with a single `gate<T>(fn)` method, injected into MCP tool registrations. Slightly more ceremony but matches the project's "everything is a service" pattern and makes the gate testable in isolation with mock state.

Either is better than a stray `write-gate.ts` next to `*.service.ts` siblings.

### 4.6 Naming changes (priority: low)

- `FileWatcherService` → split per §4.3, but if kept as one class, rename to `IndexerLifecycleService`.
- `registerWritten` → `acknowledgeWrite` (covered separately).
- If §4.5 option 2 is adopted: `write-gate.ts` → `write-gate.service.ts`.

## 5. Summary of action items

| # | Item | Priority | Effort |
|---|------|----------|--------|
| 1 | Decide watcher behavior in production: fix bootstrap to call `start()`, or delete the watch loop | **High** | S |
| 2 | Split `FileSyncService` into `FileSyncService` + `GraphProjectionService` + `StalenessService` | **High** | M |
| 3 | Route `IndexerService.removeVanished` through `FileSyncService.removeFile` | Medium | S |
| 4 | Decide on `write-gate` shape: helpers next to `IndexStateService`, or a `WriteGateService` | Low | S |
| 5 | Consolidate `KINDS`/`VALID_EXTENSIONS`/subdir mapping in one module | Low | S |
| 6 | Rename `FileWatcherService` once §1 is resolved | Low | XS |
