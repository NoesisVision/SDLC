# New design

Introduce new services and repositories design. Each service and repository suffix with "New". Do not touch old services and repositories.

Create BDD style tests for new services. All rules must be tested, all corner cases must be tested so that mutation tests can pass right after implementation.

Scope of this iteration: implement only the new services, the new repositories and their tests. Do not wire the new code into bootstrap (no new IndexerNewService / FileWatcherNewService running on `OnApplicationBootstrap`, no new MCP tool registrations, no UI re-pointing). The existing services keep handling production requests until a separate cutover step.

## General rules

- Each type of domain concept should be handled by its service. Do not create services that perform operations on all concepts eg. while indexing.
- Graph DB (Ladybug) is a cache - source files in `noesis` directory are source of truth.
- Files in `noesis` direcory (source of truth) may be changed on disk due to git operations or any other reason - it's allowed. DB should re-index relevant data in such case.
- Some data may be modified by user explicitly (now in the UI). Such modified data should be flagged per field as locked (eg. `description`, `description_locked`). Locked data may be edited by user but not by agent using skills. Agent should always ask for permission to change such data. Method for modification should have additional argument `confirmed_by_user` and only whet it's set to `true` the modification can change locked fields. Locking after user modification and changes in source files are two completely different concepts in this domain.
- The legacy file-level `edited_by_user` flag is removed in the new model. Per-field locks are the only mechanism. The UI sets a `<field>_locked` flag to `true` only when a user edit actually changes the field's value; if the new value equals the current value, neither the field nor its lock is rewritten.
- Locks attach **only to user-editable fields**. System-managed fields (e.g. a decision slot's `supporting_content`, item `source_sha` values, hashes, timestamps, ids, parent ids) are never locked and may be rewritten by skills and the splitter without `confirmed_by_user`.
- For DesignDocs, locks apply at every level of the nested tree — every editable name and description on `DesignDoc`, `BoundedContext`, `Module`, `BuildingBlock`, `Behaviour`, `Rule`, `Scenario`, `QualityAttribute`, `Property`, and `Actor` gets its own `<field>_locked: bool` sibling.
- `confirmed_by_user` is a single boolean argument on every modification method. When `false` (the default), the operation aborts if it would overwrite any locked field. When `true`, all locks for the targeted entity are bypassed for that call. Per-field opt-in (today's `confirmed_edits: string[]`) is removed.
- Business-level validation of skill output (refs resolve, all topics `reviewed: true`, no orphan items, etc.) is preserved. Each merge service exposes a private validation method that runs as the first step of the merge after the typed load; merge fails on validation errors before any file write.
- Be careful when term "diff" is used. It's crucial domain concept. Design Doc is a diff between current model and designed model - it tells what must be added, modified, deleted. Term diff can also be used in the sense of changes between two versions of a domain object eg. DesignDoc or Topic. These two meanings are different so NEVER replace them.
- Each source file should have corresponding record in DB with hash for changes detection. For conversations the only tracked hash is the json file (`StructuredConversation`); the cleaned `<id>.md` transcript is not hash-tracked.
- Skill output (`output.json`) is consumed by the merge entrypoint as a typed object — loading it through the corresponding Zod schema is the validation step. There is no separate `validate_output` MCP tool in the new model.
- A merge call may proceed while the indexer is running. Merge writes new/updated source files; the indexer's next pass picks up those files and updates the DB. No write-gate against the indexer.
- When a source file is deleted the indexer removes only that file's own rows and its relations from DB. Sibling entities that still have their own source file (e.g. a topic that was linked to the deleted conversation) are not removed; their staleness is reflected via per-item `source_sha` mismatch (see Staleness).
- Cross-domain repository access is expected. The orchestrating service for a merge (e.g. `ConversationsService`, `DocumentsService`) calls repositories from other domains directly (`TopicsRepository`, `DecisionsRepository`, `DesignDocsRepository`). Each split-out source file is saved by its own domain's repository — the repository owns the on-disk layout for its kind.
- Canonical-path computation for a kind is a responsibility of that kind's service (e.g. `TopicsService` for topic files, `DesignDocsService` for design-doc files). The repository writes to the path the service supplies.
- The implement-design-doc subsystem (`ScannerService`, `InvocationsService`, `ImplementationCheckService`, the `implement-design-doc` skill) is out of scope of this refactor and stays as-is.
- Manual user creation/deletion of topics and decisions, topic reparenting, and adding/removing alternative options on a decision are deferred to a future iteration. Today's UI exposes only field-level edits and the new model preserves that scope.
- Reuse existing data structures. If changes are needed confirm them before implementation.

## Conversations

ConversationsService should accept `analyze-conversation` skill output. The skill writes its files (the `output.json` analysis payload and the cleaned `<id>.md` transcript) into its working dir, not to the final `noesis/` location, and passes both paths to ConversationsService. ConversationsService reads both files, runs business-level validation (the same private-method pattern used by DocumentsService — refs resolve, all topics reviewed, etc.), splits the payload into source files, and saves everything to its final canonical location via the owning repositories: the conversation's `StructuredConversation` json and cleaned `<id>.md` via ConversationsRepository, topics via TopicsRepository, decisions via DecisionsRepository. The cleaned `<id>.md` is not part of the change-detection set.

ConversationsRepository should perform both DB operations and source files operations for conversations.

ConversationsService should handle indexing the `StructuredConversation` json file - storing its content in DB. All operations on DB should be delegated to ConversationsRepository. ConversationsService should only orchestrate the process. At the end hash of the indexed `StructuredConversation` file should be stored in DB for change detection algorithm.

## Documents

DocumentsService should accept `analyze-design-draft` skill output. The skill writes two files into its working dir: `output.json` (the analysis payload — document, topics, decisions, decision_attachments, …) and the design-doc JSON (when a design doc was extracted). It does **not** write either to its final `noesis/` location. The skill passes both working-dir paths to DocumentsService.

DocumentsService reads both files, runs business-level validation (refs resolve, all topics reviewed, design-doc schema satisfied — implemented as a private method per the General rules), splits the analysis payload into source files, and saves everything to its final canonical location. Per-kind saves go through the owning repository: the document json via DocumentsRepository, topics via TopicsRepository, decisions via DecisionsRepository, the design-doc json via DesignDocsRepository. DocumentsService is the single orchestrator — there is no separate `save_design_doc` call from the agent.

The skill output's `decision_attachments` (new fragment refs to attach to existing decisions) is split into the affected decision files: each entry appends its `DocumentFragmentRef` to the target slot's `supporting_content` (`context`, `decision`, or the indicated `alternative_options[i]`) on disk. `supporting_content` is not user-editable and carries no lock; appends are unconditional and de-duplicated per slot. The indexer projects the change to DB on its next pass.

DocumentsRepository should perform both DB operations and source files operations for documents.

DocumentsService should handle indexing document file (json) - storing its content in DB. All operations on DB should be delegated to DocumentsRepository. DocumentsService should only orchestrate the process. At the end hash of indexed file should be stored in DB for change detection algorithm.

## Topics

TopicsService should allow manual changes by end user. Title, short description and long description should be editable. All editable fields require lock field. Manual changes should be saved to source file. Then indexing process will update DB as for all other kind of changes.

TopicsRepository should perform both DB operations and source files operations for topics.

TopicsService should handle indexing topic file (json) - storing its content in DB. All operations on DB should be delegated to TopicsRepository. TopicsService should only orchestrate the process. At the end hash of indexed file should be stored in DB for change detection algorithm.

TopicsService should allow staleness detection for topics. Each topic item (idea-unit ref or document-fragment ref) carries the `source_sha` of its source file at ref-creation time. A topic is flagged stale when any item's `source_sha` differs from the current `SourceFile.sha` for the same source (per-item granularity, matching the current model). The flag should be stored in both source file and DB. Change to the file should be made only if new value is different that existing. Changes in DB will be applied by re-indexing process.

## Decisions

DecisionsService should allow manual changes by end user. Title, status, context's text, decision's text and rationale,  alternative options' text and rationale should be editable. All editable fields require lock field. Manual changes should be saved to source file. Then indexing process will update DB as for all other kind of changes.

DecisionsRepository should perform both DB operations and source files operations for decisions.

DecisionsService should handle indexing decision file (json) - storing its content in DB. All operations on DB should be delegated to DecisionsRepository. DecisionsService should only orchestrate the process. At the end hash of indexed file should be stored in DB for change detection algorithm.

DecisionsService should allow staleness detection for decisions. Each `supporting_content[]` entry (on every slot — `context`, `decision`, `alternative_options[i]`) carries the `source_sha` of its source file at ref-creation time. A decision is flagged stale when any referenced item's `source_sha` differs from the current `SourceFile.sha` for the same source (per-item granularity, matching the current model). The flag should be stored in both source file and DB. Change to the file should be made only if new value is different that existing. Changes in DB will be applied by re-indexing process.

## Design Docs

DesignDocsService should accept `create-design-doc` skill output, split it into source files and save these files on disk. Save operations should be performed by DesignDocsRepository. DesignDocsService also computes the canonical filename for each design doc (slug-up-to-20 + id-suffix); DesignDocsRepository writes to the path the service supplies and removes the previous file on rename.

DesignDocsService should allow manual changes by end user. All names and descriptions should be editable. All editable fields require lock field. Manual changes should be saved to source file. Then indexing process will update DB as for all other kind of changes.

Actors are part of the design-doc source file (they are no longer a separate graph-global catalog with its own `upsert_actor` write path). Each actor is referenced by `behaviour.actor` on `application_service` behaviours and is processed by DesignDocsService as part of the design-doc payload. Actors reach the DB exclusively via the design-doc indexing path.

Actors are **graph-global by name, per-doc on disk**: when two design docs both define an actor named `Customer`, the indexer projects them to the same Actor node in the graph (deduped by name). On disk each design-doc file keeps its own actor entries — there is no separate global catalog file. Conflicting descriptions across docs are not validated; last-indexed write wins on the shared graph node.

DesignDocsRepository should perform both DB operations and source files operations for design docs.

DesignDocsService should handle indexing design doc file (json) - storing its content in DB. All operations on DB should be delegated to DesignDocsRepository. DesignDocsService should only orchestrate the process. At the end hash of indexed file should be stored in DB for change detection algorithm.

DesignDocsService should allow to mark design doc as implemented. The transition is triggered by the `implement-design-doc` skill (today's `markDesignDocImplemented` entrypoint) and handled by DesignDocsService — it is not a UI action. Once implemented, the design doc cannot be modified (manually by user or by `create-design-doc` skill); both write paths must reject it.

## Indexer

IndexerService should perform such operations:

- check consistency between source files and DB on server startup
- watch for changes in files in `noesis` directory when server is running

### Concurrency

There must be at most one indexing process in one moment in time. Next request should enqueue the need of re-indexing but must never trigger parallel indexing operation. Check if file watcher may produces concurrency problems here.

### File Watcher

Changes detected by file watched should be debounced. Indexing may start after 1s. of time without requests. If new request occurs during this 1s. debouncing period the period should be restarted.

Changes detected by watcher may be caused by git operation, manual edition or saving skill output by some service (eg. ConversationService). All changes should be treated the same.

For now detecting change should trigger full re-index no mater how many files have actually changed.

### Detecting changes

When indexing is triggered all files from `noesis` directory should be checked if they current hash is equal to the hash stored in DB. If yes, nothing should happen. If no, the file should be passed to appropriate service to update DB. DB update should always be done be service connected with given domain concept eg. change in conversation file should be handled by ConversationService.

If some source file is deleted then corresponding data from DB should also be deleted. Deletion should be performed by appropriate service.

### Staleness detection

After re-indexing the DB staleness detection should be performed. Indexer only orchestrate the process and delegate the execution to TopicsService and DecisionsService. 