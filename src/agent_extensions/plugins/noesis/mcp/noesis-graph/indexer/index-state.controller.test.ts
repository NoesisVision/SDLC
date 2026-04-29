import { describe, expect, test } from "bun:test";
import { IndexStateController } from "./index-state.controller.js";
import { IndexStateService } from "./index-state.service.js";

describe("IndexStateController", () => {
  test("returns the current state from the service", () => {
    const service = new IndexStateService();
    service.markConsistent(2);
    const controller = new IndexStateController(service);
    const result = controller.get();
    expect(result.state).toBe("consistent");
    expect(result.stale_dependents).toBe(2);
    expect(result.last_completed_at).not.toBeNull();
  });

  test("reflects subsequent state changes", () => {
    const service = new IndexStateService();
    const controller = new IndexStateController(service);
    expect(controller.get().state).toBe("indexing");
    service.markConsistent(0);
    expect(controller.get().state).toBe("consistent");
  });
});
