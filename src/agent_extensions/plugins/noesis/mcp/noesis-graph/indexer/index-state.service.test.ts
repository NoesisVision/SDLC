import { describe, expect, test } from "bun:test";
import { IndexStateService } from "./index-state.service.js";

describe("IndexStateService", () => {
  test("starts in indexing state with zero progress", () => {
    const svc = new IndexStateService();
    const state = svc.get();
    expect(state.state).toBe("indexing");
    expect(state.files_total).toBe(0);
    expect(state.files_processed).toBe(0);
    expect(state.last_completed_at).toBeNull();
    expect(state.last_error).toBeNull();
    expect(state.stale_dependents).toBe(0);
  });

  test("isWriteAllowed false until consistent", () => {
    const svc = new IndexStateService();
    expect(svc.isWriteAllowed()).toBe(false);
    svc.markConsistent(0);
    expect(svc.isWriteAllowed()).toBe(true);
    svc.markError("boom");
    expect(svc.isWriteAllowed()).toBe(false);
  });

  test("beginIndexing resets progress and records total", () => {
    const svc = new IndexStateService();
    svc.markConsistent(0);
    svc.beginIndexing(7);
    const state = svc.get();
    expect(state.state).toBe("indexing");
    expect(state.files_total).toBe(7);
    expect(state.files_processed).toBe(0);
    expect(state.last_error).toBeNull();
  });

  test("recordFileProcessed increments counter", () => {
    const svc = new IndexStateService();
    svc.beginIndexing(2);
    svc.recordFileProcessed();
    expect(svc.get().files_processed).toBe(1);
    svc.recordFileProcessed();
    expect(svc.get().files_processed).toBe(2);
  });

  test("markConsistent records timestamp and stale count", () => {
    const svc = new IndexStateService();
    svc.markConsistent(3);
    const state = svc.get();
    expect(state.state).toBe("consistent");
    expect(state.stale_dependents).toBe(3);
    expect(state.last_completed_at).not.toBeNull();
    expect(state.last_error).toBeNull();
  });

  test("markError captures the message", () => {
    const svc = new IndexStateService();
    svc.markError("scan failed");
    const state = svc.get();
    expect(state.state).toBe("error");
    expect(state.last_error).toBe("scan failed");
  });

  test("subscribers receive updates and can unsubscribe", () => {
    const svc = new IndexStateService();
    const captured: string[] = [];
    const off = svc.subscribe((state) => captured.push(state.state));
    svc.beginIndexing(1);
    svc.markConsistent(0);
    off();
    svc.markError("ignored");
    expect(captured).toEqual(["indexing", "consistent"]);
  });

  test("get returns a defensive copy", () => {
    const svc = new IndexStateService();
    const snapshot = svc.get();
    snapshot.files_total = 999;
    expect(svc.get().files_total).toBe(0);
  });
});
