export type IndexPhase = "indexing" | "consistent" | "error";

export interface IndexStateData {
  state: IndexPhase;
  files_total: number;
  files_processed: number;
  last_completed_at: string | null;
  last_error: string | null;
  stale_dependents: number;
}
