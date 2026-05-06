import { describe, test, expect } from "bun:test";
import { and, given, then, when } from "@tests/bdd.js";
import {
  IndexStateService,
  type IndexState,
} from "@noesis/mcp/noesis-graph/indexer/index-state.service.js";

describe("IndexStateService — observable state of the file/graph indexer", () => {
  test("the freshly constructed service starts in the indexing state", async () => {
    let snapshot: IndexState;

    await given("a brand new IndexStateService", () => {});
    await when("a consumer reads its current state", () => {
      const service = new IndexStateService();
      snapshot = service.get();
    });
    await then(
      "the state is 'indexing' with zero counts and no completion timestamp",
      () => {
        expect(snapshot).toEqual({
          state: "indexing",
          files_total: 0,
          files_processed: 0,
          last_completed_at: null,
          last_error: null,
          stale_dependents: 0,
        });
      },
    );
  });

  test("writes are gated until the indexer reaches the consistent state", async () => {
    let allowedDuringIndexing: boolean;
    let allowedAfterConsistent: boolean;
    let allowedAfterError: boolean;

    await given(
      "a service that toggles through indexing → consistent → error in turn",
      () => {},
    );
    await when("write-permission is checked at each phase", () => {
      const service = new IndexStateService();
      allowedDuringIndexing = service.isWriteAllowed();
      service.markConsistent(0);
      allowedAfterConsistent = service.isWriteAllowed();
      service.markError("boom");
      allowedAfterError = service.isWriteAllowed();
    });
    await then("only the consistent state allows writes", () => {
      expect(allowedDuringIndexing).toBe(false);
      expect(allowedAfterConsistent).toBe(true);
      expect(allowedAfterError).toBe(false);
    });
  });

  test("beginIndexing resets the counters and clears any prior error", async () => {
    let snapshot: IndexState;

    await given("a service that previously reached an error state", () => {});
    await when(
      "the indexer is restarted with a known total file count",
      () => {
        const service = new IndexStateService();
        service.markError("previous failure");
        service.beginIndexing(42);
        snapshot = service.get();
      },
    );
    await then("the state reverts to indexing with the new total and zero processed", () => {
      expect(snapshot.state).toBe("indexing");
      expect(snapshot.files_total).toBe(42);
      expect(snapshot.files_processed).toBe(0);
    });
    await and("the prior error message is cleared", () => {
      expect(snapshot.last_error).toBeNull();
    });
  });

  test("each processed file advances the progress counter by one", async () => {
    let processed: number;

    await given("a service that has just begun indexing 5 files", () => {});
    await when("two files are reported as processed", () => {
      const service = new IndexStateService();
      service.beginIndexing(5);
      service.recordFileProcessed();
      service.recordFileProcessed();
      processed = service.get().files_processed;
    });
    await then("the processed count reflects exactly the number of reports", () => {
      expect(processed).toBe(2);
    });
  });

  test("markConsistent records a fresh completion timestamp and the stale-dependent count", async () => {
    let snapshot: IndexState;

    await given("a service that has finished indexing with three stale dependents", () => {});
    await when("the indexer marks itself consistent", () => {
      const service = new IndexStateService();
      service.beginIndexing(2);
      service.markConsistent(3);
      snapshot = service.get();
    });
    await then("the state is 'consistent' with the dependent count recorded", () => {
      expect(snapshot.state).toBe("consistent");
      expect(snapshot.stale_dependents).toBe(3);
    });
    await and("a non-empty ISO timestamp is stamped onto last_completed_at", () => {
      expect(snapshot.last_completed_at).not.toBeNull();
      expect(typeof snapshot.last_completed_at).toBe("string");
      expect(snapshot.last_completed_at!.length).toBeGreaterThan(0);
    });
  });

  test("markError captures the error message while preserving prior counts", async () => {
    let snapshot: IndexState;

    await given(
      "a service mid-indexing with one file already processed",
      () => {},
    );
    await when("the indexer reports a failure with a descriptive message", () => {
      const service = new IndexStateService();
      service.beginIndexing(2);
      service.recordFileProcessed();
      service.markError("disk full");
      snapshot = service.get();
    });
    await then("the state is 'error' carrying the message", () => {
      expect(snapshot.state).toBe("error");
      expect(snapshot.last_error).toBe("disk full");
    });
    await and("the counters from before the failure are still visible", () => {
      expect(snapshot.files_total).toBe(2);
      expect(snapshot.files_processed).toBe(1);
    });
  });

  test("subscribers are notified of each state change until they unsubscribe", async () => {
    const events: IndexState[] = [];

    await given("a service with one registered listener", () => {});
    await when(
      "two updates fire and the listener then unsubscribes before a third update",
      () => {
        const service = new IndexStateService();
        const unsubscribe = service.subscribe((s) => {
          events.push({ ...s });
        });
        service.beginIndexing(1);
        service.recordFileProcessed();
        unsubscribe();
        service.markConsistent(0);
      },
    );
    await then("only the events while subscribed reach the listener", () => {
      expect(events).toHaveLength(2);
      expect(events[0].state).toBe("indexing");
      expect(events[0].files_total).toBe(1);
      expect(events[1].files_processed).toBe(1);
    });
  });

  test("get() returns a snapshot copy that the caller can read but cannot mutate", async () => {
    let snapshot: IndexState;
    let updatedAfter: IndexState;

    await given("a service with no updates yet", () => {});
    await when("a caller mutates the returned snapshot in place", () => {
      const service = new IndexStateService();
      snapshot = service.get();
      (snapshot as IndexState).files_total = 999;
      updatedAfter = service.get();
    });
    await then("the internal state is unaffected by the external mutation", () => {
      expect(updatedAfter.files_total).toBe(0);
    });
  });
});
