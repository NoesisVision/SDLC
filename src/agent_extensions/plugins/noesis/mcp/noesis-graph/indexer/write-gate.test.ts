import { describe, expect, test } from "bun:test";
import { IndexStateService } from "./index-state.service.js";
import { gateWriteTool, notReady } from "./write-gate.js";

describe("notReady", () => {
  test("returns the indexing message when state is indexing", () => {
    const svc = new IndexStateService();
    expect(notReady(svc).message).toContain("scanning");
  });

  test("returns the error message when state is error", () => {
    const svc = new IndexStateService();
    svc.markError("boom");
    expect(notReady(svc).message).toContain("error state");
  });
});

describe("gateWriteTool", () => {
  test("returns NotReady while indexing", async () => {
    const svc = new IndexStateService();
    let called = false;
    const result = await gateWriteTool(svc, async () => {
      called = true;
      return { ok: true };
    });
    expect(called).toBe(false);
    expect((result as { status: string }).status).toBe("NotReady");
  });

  test("delegates to the inner function once consistent", async () => {
    const svc = new IndexStateService();
    svc.markConsistent(0);
    const result = await gateWriteTool(svc, async () => ({ id: "x" }));
    expect(result).toEqual({ id: "x" });
  });

  test("blocks writes again after entering error state", async () => {
    const svc = new IndexStateService();
    svc.markConsistent(0);
    svc.markError("disk full");
    const result = await gateWriteTool(svc, async () => ({ id: "x" }));
    expect((result as { status: string }).status).toBe("NotReady");
  });
});
