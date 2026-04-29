import type { IndexStateService } from "./index-state.service.js";

export interface NotReady {
  status: "NotReady";
  message: string;
}

export function notReady(state: IndexStateService): NotReady {
  const phase = state.get().state;
  const reason =
    phase === "indexing"
      ? "Indexer is still scanning noesis/ — try again shortly."
      : "Indexer is in error state; resolve the issue before retrying.";
  return { status: "NotReady", message: reason };
}

export async function gateWriteTool<T>(
  state: IndexStateService,
  fn: () => Promise<T>,
): Promise<T | NotReady> {
  if (!state.isWriteAllowed()) return notReady(state);
  return fn();
}
