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

## Graph model

The graph DB and the on-disk JSON files describe the same domain but are **two different models by nature** — do not collapse them into one shape.

- **The DB is a full index of the on-disk source files.** Every nested entity in a source file must materialise as its own graph node — not as a JSON blob on the parent, not as a sub-property, not as an array column. If a source-file field describes a thing with its own identity (a `DesignedBuildingBlock`, a `DocumentFragment`, a `DecisionOption`), the graph has a `CREATE NODE TABLE` for it. A "design doc with only `DesignDoc` and `Actor` nodes" is an incomplete projection, not a design choice — the rest of the structure belongs in the graph too.
- **JSON files store cross-entity references as scalar fields** (e.g. `Topic.parent_id`, `Decision.topic_id`, `supporting_content[].source_sha` on each decision slot). That is the right shape for a file: flat, self-contained, diff-friendly.
- **Every cross-entity reference between node types MUST be modelled as a `CREATE REL TABLE` edge** — never as a scalar foreign-key column on the node. The Schema Explorer is the canonical view of the DB model; if a node looks "orphan" there, the model is wrong.
- **ChangeSet projection — one edge per slot.** When a source-file field is a `{ added, modified, removed }` ChangeSet, project each non-empty slot as its own per-parent-per-child rel table: `<PARENT>_HAS_ADDED_<CHILD>` and `<PARENT>_HAS_MODIFIED_<CHILD>`. The slot lives in the edge name, never as a property on the child node. Example: `DesignDoc -[:DESIGNDOC_HAS_ADDED_BOUNDED_CONTEXT]-> DesignedBoundedContext`, `DesignedBoundedContext -[:BOUNDED_CONTEXT_HAS_MODIFIED_MODULE]-> DesignedDomainModule`.
- **`removed` slots stay scalar.** A `removed` slot is a list of names with no body data, so it doesn't have a node to attach to. Store it as a `STRING[]` field on the parent named `removed_<child>_names` (e.g. `DesignDoc.removed_bounded_context_names`). This is the only sanctioned exception to the rel-table rule and applies uniformly wherever a ChangeSet has a name-only `removed` slot.
- **Other scalar exceptions are by-name references that can't be resolved at upsert time** (e.g. `DesignedBehaviour.input/output/used_building_blocks`, `DesignedBuildingBlock.implements`). They reference entities that may live in a different doc, be declared later, or never resolve at all. Keep them scalar `STRING[]` on the source node and write the reason inline in the repository (matching the comment block above `SCHEMA_STATEMENTS`). Never invent a placeholder node to satisfy the rule.
- **Owned subgraph identity.** Every node owned by a domain root (e.g. nested design-doc entities owned by a `DesignDoc`) carries a `design_doc_id` (or equivalent root-id) field so the repository can wipe and reproject the subgraph on re-index via `MATCH (n:Label) WHERE n.design_doc_id = $id DETACH DELETE n` per nested label — no edge-walking required.
- **Repositories translate between the two**: the JSON-side scalar field becomes a graph edge on `upsert` (DELETE the existing edge, then `MATCH ... CREATE (a)-[:REL]->(b)`), and reads project the edge target's id back as the scalar field on the stored type via `OPTIONAL MATCH (n)-[:REL]->(target) ... RETURN target.id AS <field>`. Service-layer code keeps consuming the scalar field unchanged.
- **Indexer ordering matters**: when one entity's edge points at another (e.g. Decision → Topic), the target node must already exist when the source is upserted. Discovery iterates `SOURCE_FILE_KINDS` in declaration order (`source-files.ts`) and a single full re-index pass is the only re-indexing path, so list the kinds in dependency order (parents before children) and the invariant holds.

## Boundaries

- **No LLM in the MCP server**: `noesis-graph` has no Anthropic API access. All semantic reasoning (Goldilocks topic search, summarisation, decision/design extraction) happens in the agent driving the skill. The server provides deterministic data access only.

## Testing

- **Never run `bun test` for the whole noesis plugin.** Bun segfaults when more than one test file initialises/closes the `lbug` (Kuzu fork) native binding in the same process. Single-file runs (`bun test path/to/x.test.ts`) are fine.
- **Use the wrapper to run the full suite**: `bun run scripts/run-tests.ts` from `src/agent_extensions/plugins/noesis/`. It executes each `*.test.ts` in its own Bun subprocess and aggregates results.

## File-first persistence

- **Source of truth lives on disk** under `<projectDir>/noesis/` as JSON source files only. **No markdown files are stored in `noesis/`.** The user's original transcripts and document drafts live wherever the user keeps them and are never copied, modified, or stamped by the plugin; if a user happens to place an md file inside `noesis/`, the indexer ignores it.
  - `conversations/<slug>-<id-suffix>.json` — full conversation source file (turns, idea units, main_topic, time).
  - `documents/<slug>-<id-suffix>.json` — full document source file (the raw markdown lives in the file's `content` field; fragments + section tree alongside).
  - `topics/<slug>-<id-suffix>.json` — flat topic file with `parent_id`; items carry `source_sha`.
  - `decisions/<slug>-<id-suffix>.json` — decision file with `topic_id`; referenced items carry `source_sha`.
  - `design-docs/<slug>-<id-suffix>.json` — design doc.

  `<slug>` is the entity's name/title slugified and capped at 30 chars (kebab-case); `<id-suffix>` is the last 8 hex chars of the id (extended only on collision). Filename helpers live in `shared-contracts/source-files.ts`.

- **Source file extensions allowlist**: `SOURCE_FILE_EXTENSIONS = [".json"]` — `discoverSourceFiles` only picks up `.json` source files. Stray `.md` files in any `noesis/` subdir are not indexed and do not produce DB rows.

- **ID rules**:
  - **Conversation `id` and Document `id` are content-hash UUIDs**: the sha-256 of the raw md input bytes, formatted as a UUID (8-4-4-4-12). The hash is computed by `contentHashAsUuid(content)` in `shared-contracts/uuid.ts`. Re-running the prepare script on the same source bytes produces the same id, which is how duplicate detection works.
  - **The id is never written into the md** — the user's source file is read but not modified, and the hash covers the original bytes. Anything that would mutate the input (stamping, normalisation) is forbidden.
  - **Topic, Decision, DesignDoc, Actor ids are UUID v7**: `Bun.randomUUIDv7()` (`newUuid()`). Time-ordered, random tail.
  - **Duplicate detection is the skill's responsibility**: after `prepare.ts` returns the content-hash id, the skill MUST call `noesis-graph:has_conversation` / `noesis-graph:has_document` before analysis. If `exists: true` the skill aborts with a "duplicate" message — the source has already been processed.

- The graph DB is a **cache rebuilt from these JSON source files**. Skills produce the same output they always have; each domain service splits that output into its canonical files inline (e.g. `conversations.uploadAnalysis`, `documents.uploadAnalysis`, `designDocs.persistFile`). There is no separate splitter or file-sync layer.
- **User edits are protected per-field via `*_locked` flags** (e.g. `title_locked`, `short_summary_locked`, `decision.text_locked`). The UI edit methods (`editFieldsAndLock`, `editTopFieldsAndLock`, `editAlternativeOptionAndLock`) set the lock when a field is changed. On the next skill-driven upload/merge, the service preserves any locked field instead of overwriting it; unlocked fields are replaced as usual.
- **Cross-file references store `source_sha`** (sha-256 of the referenced source file at ref-creation time). Mismatches are how the indexer detects stale dependents.
- **Indexer**: `IndexerService` (`mcp/noesis-graph/indexer/indexer.service.ts`) owns index state (`idle` / `indexing` / `consistent` / `error`) and drives `runFullIndex`. A pass discovers source files under `<projectDir>/noesis/`, calls each domain service's `indexFile(path)` (which computes the file sha and upserts to the DB only when it differs from the stored sha), drops DB rows for vanished files via each domain's `deleteForFile(path)`, and finally calls `topics.refreshStaleFlags` / `decisions.refreshStaleFlags` to recompute `is_stale` from cross-ref `source_sha` vs current node sha. Concurrent calls coalesce: at most one pass runs and at most one follow-up is queued.
- **Per-domain services own projection**: each domain (`conversations` / `documents` / `topics` / `decisions` / `design-docs`) has its own `*.service.ts` + `*.repository.ts` pair. The repository holds the node sha (`c.sha`, `d.sha`, etc.) on the DB node directly — there is no separate `SourceFile` registry table. The service's `indexFile` is the single bridge from disk file → DB row.
- **File watcher (optional, opt-in)**: `IndexerService.startWatching()` watches `<projectDir>/noesis/` with a debounced re-index. It has no `OnApplicationBootstrap` hook — production code or tests that want filesystem-driven re-indexing must call `startWatching()` explicitly. Knowledge-domain tests deliberately leave it off so writes don't trigger async re-index events; only indexer-level tests turn the watcher on.

## Skill md-input contract

Skills whose input is a markdown file (`analyze-conversation`, `analyze-design-draft`) follow a fixed contract enforced by their `prepare.ts`:

1. `prepare.ts` reads the user-provided md path. It NEVER modifies the source file and NEVER copies it into `noesis/`.
2. The id is `contentHashAsUuid(rawInputBytes)`. Same bytes → same id.
3. `prepare.ts` writes its artifacts to a transient working directory (`<working_dir>/output.json`, and for conversations also `<working_dir>/cleaned.md`). Nothing under `noesis/` is touched.
4. The skill calls the matching MCP existence-check tool (`has_conversation` / `has_document`) before running analysis. If the id is already in the graph, the skill aborts with a duplicate message.
5. On `merge_conversation` / `merge_document`, the service writes only the JSON source file under `noesis/`. The original md remains untouched at the user's path.

## Dev seed coverage

`mcp/noesis-graph/dev/dev-seed.ts` owns the curated fixture set. Two coverage families must be preserved when the file-first models change (in `shared-contracts/source-file-schemas.ts`, `shared-contracts/design-doc-new.ts`, `shared-contracts/conversation.ts`, `shared-contracts/documents.ts`):

- **Optional / nullable shape coverage** — every optional or nullable field has at least one fixture with it `null` / omitted and one with it populated. The rich/minimal pair pattern is the convention (`actorRich()` / `actorMinimal()`, `salesBoundedContext()` / `reportingBoundedContext()`, etc.).
- **ChangeSet shape coverage** — every `{ added, modified, removed }` ChangeSet on `DesignDocFileNew` and its nested types has at least one fixture populating each slot. The greenfield doc (`greenfieldDesignDoc`) covers `added`; the tier-expansion doc (`tierExpansionDesignDoc`) covers `modified` + `removed` at every nesting level (bounded contexts, modules, building blocks, behaviours, rules, scenarios, quality attributes, properties, and string change-sets). When you introduce a new ChangeSet, extend `tierExpansionDesignDoc` so all three slots are non-empty somewhere.

When a model schema changes, update dev-seed in the same change. The general rule is in the SDLC root `CLAUDE.md` under "Dev seed coverage".
