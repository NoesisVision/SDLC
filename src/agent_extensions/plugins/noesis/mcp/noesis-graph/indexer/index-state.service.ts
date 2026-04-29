import { Injectable } from "@nestjs/common";
import type {
  IndexPhase,
  IndexStateData,
} from "../ui-contracts/index-state/index-state-data.js";

export type IndexState = IndexStateData;
export type { IndexPhase };
export type IndexStateListener = (state: IndexState) => void;

@Injectable()
export class IndexStateService {
  private current: IndexState = {
    state: "indexing",
    files_total: 0,
    files_processed: 0,
    last_completed_at: null,
    last_error: null,
    stale_dependents: 0,
  };
  private readonly listeners = new Set<IndexStateListener>();

  get(): IndexState {
    return { ...this.current };
  }

  isWriteAllowed(): boolean {
    return this.current.state === "consistent";
  }

  subscribe(listener: IndexStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  beginIndexing(filesTotal: number): void {
    this.update({
      state: "indexing",
      files_total: filesTotal,
      files_processed: 0,
      last_error: null,
    });
  }

  recordFileProcessed(): void {
    this.update({ files_processed: this.current.files_processed + 1 });
  }

  markConsistent(staleDependents: number): void {
    this.update({
      state: "consistent",
      last_completed_at: new Date().toISOString(),
      last_error: null,
      stale_dependents: staleDependents,
    });
  }

  markError(message: string): void {
    this.update({ state: "error", last_error: message });
  }

  private update(patch: Partial<IndexState>): void {
    this.current = { ...this.current, ...patch };
    for (const listener of this.listeners) listener(this.current);
  }
}
