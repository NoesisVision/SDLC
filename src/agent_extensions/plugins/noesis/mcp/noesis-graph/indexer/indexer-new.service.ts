import { Inject, Injectable, Logger } from '@nestjs/common';
import { type FSWatcher, watch } from 'fs';
import { assertNever } from '../../../shared-contracts/assert-never.js';
import {
  discoverSourceFiles,
  ensureNoesisLayout,
  noesisRoot,
  type SourceFileKind,
} from '../../../shared-contracts/source-files.js';
import { PROJECT_DIR } from '../config/config.module.js';
import { ConversationsRepositoryNew } from '../knowledge/conversations/conversations-new.repository.js';
import { ConversationsServiceNew } from '../knowledge/conversations/conversations-new.service.js';
import { DecisionsServiceNew } from '../knowledge/decisions/decisions-new.service.js';
import { DesignDocsServiceNew } from '../knowledge/design-docs/design-docs-new.service.js';
import { DocumentsRepositoryNew } from '../knowledge/documents/documents-new.repository.js';
import { DocumentsServiceNew } from '../knowledge/documents/documents-new.service.js';
import { TopicsServiceNew } from '../knowledge/topics/topics-new.service.js';

const DEFAULT_DEBOUNCE_MS = 1000;

export type IndexState = "idle" | "indexing" | "consistent" | "error";

export interface IndexResult {
  files_total: number;
  files_processed: number;
  files_deleted: number;
  stale_topics: number;
  stale_decisions: number;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

@Injectable()
export class IndexerServiceNew {
  private readonly logger = new Logger(IndexerServiceNew.name);
  private state: IndexState = "idle";
  private lastError: string | null = null;
  private watcher: FSWatcher | null = null;
  private debounceMs = DEFAULT_DEBOUNCE_MS;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private currentPass: Deferred<IndexResult> | null = null;
  private queuedPass: Deferred<IndexResult> | null = null;
  private looping = false;
  private lastResult: IndexResult | null = null;

  constructor(
    @Inject(PROJECT_DIR) private readonly projectDir: string,
    private readonly conversations: ConversationsServiceNew,
    private readonly conversationsRepository: ConversationsRepositoryNew,
    private readonly documents: DocumentsServiceNew,
    private readonly documentsRepository: DocumentsRepositoryNew,
    private readonly topics: TopicsServiceNew,
    private readonly decisions: DecisionsServiceNew,
    private readonly designDocs: DesignDocsServiceNew,
  ) {}

  getLastError(): string | null {
    return this.lastError;
  }

  getLastResult(): IndexResult | null {
    return this.lastResult;
  }

  getState(): IndexState {
    return this.state;
  }

  /**
   * Each call returns a Promise that resolves with the result of the pass that
   * starts at-or-after the call. If no pass is in flight, the call starts one
   * and observes its result. If a pass is running, the call enqueues a single
   * follow-up pass and observes its result; concurrent callers during the run
   * share that follow-up. At most one pass executes and at most one is queued.
   * State stays "indexing" until both slots drain — only then does it become
   * "consistent" (or "error" on a terminal failure with nothing queued).
   */
  async runFullIndex(): Promise<IndexResult> {
    if (this.currentPass === null) {
      this.currentPass = deferred();
      if (!this.looping) {
        this.looping = true;
        void this.drain();
      }
      return this.currentPass.promise;
    }
    if (this.queuedPass === null) {
      this.queuedPass = deferred();
    }
    return this.queuedPass.promise;
  }

  setDebounceMs(ms: number): void {
    this.debounceMs = ms;
  }

  /**
   * Start watching `<projectDir>/noesis` for changes. File-system events trigger
   * a debounced re-index. Each new event resets the debounce window. While a
   * pass is running, additional events enqueue a single follow-up pass; further
   * events during that window are coalesced into the same follow-up.
   */
  startWatching(): void {
    if (this.watcher !== null) return;
    ensureNoesisLayout(this.projectDir);
    const root = noesisRoot(this.projectDir);
    this.watcher = watch(root, { recursive: true }, () => {
      this.scheduleDebouncedReindex();
    });
    this.logger.log(`Watching ${root} (debounce ${this.debounceMs}ms)`);
  }

  stopWatching(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher !== null) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  // ----- internals -----

  private async drain(): Promise<void> {
    while (this.currentPass !== null) {
      const pending = this.currentPass;
      this.state = "indexing";
      this.lastError = null;
      try {
        const result = await this.executeFullIndex();
        this.lastResult = result;
        this.currentPass = this.queuedPass;
        this.queuedPass = null;
        if (this.currentPass === null) this.state = "consistent";
        pending.resolve(result);
      } catch (err) {
        this.lastError = (err as Error).message;
        this.currentPass = this.queuedPass;
        this.queuedPass = null;
        if (this.currentPass === null) this.state = "error";
        pending.reject(err);
      }
    }
    this.looping = false;
  }

  private async executeFullIndex(): Promise<IndexResult> {
    ensureNoesisLayout(this.projectDir);
    const discovered = discoverSourceFiles(this.projectDir);
    let processed = 0;
    const seenPaths = new Set<string>();
    for (const { kind, path } of discovered) {
      seenPaths.add(path);
      try {
        await this.indexOne(kind, path);
        processed++;
      } catch (err) {
        this.logger.warn(
          `Failed to index ${path}: ${(err as Error).message}`,
        );
      }
    }
    const filesDeleted = await this.removeVanishedFiles(seenPaths);
    const snapshot = await this.buildSourceShaSnapshot();
    const staleTopics = await this.topics.refreshStaleFlags(snapshot);
    const staleDecisions = await this.decisions.refreshStaleFlags(snapshot);
    return {
      files_total: discovered.length,
      files_processed: processed,
      files_deleted: filesDeleted,
      stale_topics: staleTopics,
      stale_decisions: staleDecisions,
    };
  }

  private async indexOne(kind: SourceFileKind, path: string): Promise<void> {
    if (kind === "conversation" && path.endsWith(".md")) {
      // cleaned md is not hash-tracked; nothing to index for change detection.
      return;
    }
    switch (kind) {
      case "conversation":
        await this.conversations.indexFile(path);
        return;
      case "document":
        await this.documents.indexFile(path);
        return;
      case "topic":
        await this.topics.indexFile(path);
        return;
      case "decision":
        await this.decisions.indexFile(path);
        return;
      case "design_doc":
        await this.designDocs.indexFile(path);
        return;
      default:
        assertNever(kind);
    }
  }

  private async removeVanishedFiles(seen: Set<string>): Promise<number> {
    let deleted = 0;
    deleted += await this.deleteVanished(
      await this.conversations.listAllStoredFiles(),
      seen,
      (path) => this.conversations.deleteForFile(path),
    );
    deleted += await this.deleteVanished(
      await this.documents.listAllStoredFiles(),
      seen,
      (path) => this.documents.deleteForFile(path),
    );
    deleted += await this.deleteVanished(
      await this.topics.listAllStoredFiles(),
      seen,
      (path) => this.topics.deleteForFile(path),
    );
    deleted += await this.deleteVanished(
      await this.decisions.listAllStoredFiles(),
      seen,
      (path) => this.decisions.deleteForFile(path),
    );
    deleted += await this.deleteVanished(
      await this.designDocs.listAllStoredFiles(),
      seen,
      (path) => this.designDocs.deleteForFile(path),
    );
    return deleted;
  }

  private async deleteVanished(
    stored: Array<{ path: string }>,
    seen: Set<string>,
    deleteFn: (path: string) => Promise<unknown>,
  ): Promise<number> {
    let count = 0;
    for (const row of stored) {
      if (seen.has(row.path)) continue;
      const res = await deleteFn(row.path);
      if (res !== null) count++;
    }
    return count;
  }

  private async buildSourceShaSnapshot(): Promise<{
    conversation: Map<string, string>;
    document: Map<string, string>;
  }> {
    const convs = await this.conversationsRepository.listAll();
    const docs = await this.documentsRepository.listAll();
    return {
      conversation: new Map(convs.map((c) => [c.id, c.sha])),
      document: new Map(docs.map((d) => [d.id, d.sha])),
    };
  }

  private scheduleDebouncedReindex(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runFullIndex();
    }, this.debounceMs);
  }
}
