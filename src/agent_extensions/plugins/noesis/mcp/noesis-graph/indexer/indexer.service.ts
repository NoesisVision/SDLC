import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  discoverSourceFiles,
  ensureNoesisLayout,
} from "../../../shared-contracts/source-files.js";
import { PROJECT_DIR } from "../config/config.module.js";
import { FileSyncService } from "../file-sync/file-sync.service.js";
import { SourceFilesRepository } from "../file-sync/source-files.repository.js";
import { StalenessService } from "../file-sync/staleness.service.js";
import type {
  IndexPhase,
  IndexStateData,
} from "../ui-contracts/index-state/index-state-data.js";

export type IndexState = IndexStateData;
export type { IndexPhase };
export type IndexStateListener = (state: IndexState) => void;

export interface NotReady {
  status: "NotReady";
  message: string;
}

export const WRITE_GATE_RETRY_DELAY_MS = 1000;

@Injectable()
export class IndexerService {
  private readonly logger = new Logger(IndexerService.name);
  private state: IndexState = {
    state: "indexing",
    files_total: 0,
    files_processed: 0,
    last_completed_at: null,
    last_error: null,
    stale_dependents: 0,
  };
  private readonly listeners = new Set<IndexStateListener>();
  private writeGateRetryDelayMs = WRITE_GATE_RETRY_DELAY_MS;

  constructor(
    @Inject(PROJECT_DIR) private readonly projectDir: string,
    private readonly fileSync: FileSyncService,
    private readonly sourceFiles: SourceFilesRepository,
    private readonly staleness: StalenessService,
  ) {}

  getState(): IndexState {
    return { ...this.state };
  }

  isWriteAllowed(): boolean {
    return this.state.state === "consistent";
  }

  subscribe(listener: IndexStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async runFullIndex(): Promise<void> {
    try {
      ensureNoesisLayout(this.projectDir);
      const discovered = discoverSourceFiles(this.projectDir);
      this.beginIndexing(discovered.length);
      const seenPaths = new Set<string>();
      for (const { path } of discovered) {
        seenPaths.add(path);
        try {
          await this.fileSync.loadFile(path);
        } catch (err) {
          this.logger.warn(
            `Failed to load ${path}: ${(err as Error).message}`,
          );
        }
        this.recordFileProcessed();
      }
      await this.removeVanishedRegistryRows(seenPaths);
      const stale = await this.staleness.refreshStaleFlags();
      this.markConsistent(stale);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Index failed: ${message}`);
      this.markError(message);
    }
  }

  async gateWrite<T>(fn: () => Promise<T>): Promise<T | NotReady> {
    if (this.isWriteAllowed()) return fn();
    await delay(this.writeGateRetryDelayMs);
    if (this.isWriteAllowed()) return fn();
    return this.notReady();
  }

  setWriteGateRetryDelayMs(ms: number): void {
    this.writeGateRetryDelayMs = ms;
  }

  private notReady(): NotReady {
    const message =
      this.state.state === "indexing"
        ? "Indexer is still scanning noesis/ — try again shortly."
        : "Indexer is in error state; resolve the issue before retrying.";
    return { status: "NotReady", message };
  }

  private async removeVanishedRegistryRows(
    seenPaths: Set<string>,
  ): Promise<void> {
    const known = await this.sourceFiles.listAll();
    for (const row of known) {
      if (seenPaths.has(row.path)) continue;
      await this.fileSync.removeFile(row.path);
    }
  }

  private beginIndexing(filesTotal: number): void {
    this.update({
      state: "indexing",
      files_total: filesTotal,
      files_processed: 0,
      last_error: null,
    });
  }

  private recordFileProcessed(): void {
    this.update({ files_processed: this.state.files_processed + 1 });
  }

  private markConsistent(staleDependents: number): void {
    this.update({
      state: "consistent",
      last_completed_at: new Date().toISOString(),
      last_error: null,
      stale_dependents: staleDependents,
    });
  }

  private markError(message: string): void {
    this.update({ state: "error", last_error: message });
  }

  private update(patch: Partial<IndexState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
