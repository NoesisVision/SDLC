import "reflect-metadata";
import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { DatabaseService } from "../../database/database.service.js";
import { InvocationsRepository } from "./invocations.repository.js";

describe("InvocationsRepository", () => {
  let db: DatabaseService;
  let repo: InvocationsRepository;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "noesis-invrepo-"));
    db = new DatabaseService(tmpDir);
    db.onModuleInit();
    repo = new InvocationsRepository(db);

    const conn = db.getConnection();
    await conn.query(
      "CREATE NODE TABLE IF NOT EXISTS Behavior(id STRING, name STRING, PRIMARY KEY(id))",
    );
    await repo.initSchema();
    const ins = await conn.prepare("CREATE (:Behavior {id: $id, name: $name})");
    for (const id of ["A", "B", "C"]) {
      await conn.execute(ins, { id, name: id });
    }
  });

  afterAll(async () => {
    await db.onModuleDestroy();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await repo.clearInvocations();
  });

  test("writes and reads an invocation edge", async () => {
    await repo.insertInvocation({ source: "A", destination: "B" });
    const all = await repo.getInvocations();
    expect(all).toEqual([{ source: "A", destination: "B" }]);
  });

  test("clearInvocations removes all edges", async () => {
    await repo.insertInvocation({ source: "A", destination: "B" });
    await repo.insertInvocation({ source: "B", destination: "C" });
    await repo.clearInvocations();
    expect(await repo.getInvocations()).toEqual([]);
  });

  test("filter by sourceBehaviorId", async () => {
    await repo.insertInvocation({ source: "A", destination: "B" });
    await repo.insertInvocation({ source: "A", destination: "C" });
    await repo.insertInvocation({ source: "B", destination: "C" });
    const rows = await repo.getInvocations({ sourceBehaviorId: "A" });
    expect(rows).toEqual([
      { source: "A", destination: "B" },
      { source: "A", destination: "C" },
    ]);
  });

  test("filter by destinationBehaviorId", async () => {
    await repo.insertInvocation({ source: "A", destination: "C" });
    await repo.insertInvocation({ source: "B", destination: "C" });
    const rows = await repo.getInvocations({ destinationBehaviorId: "C" });
    expect(rows).toEqual([
      { source: "A", destination: "C" },
      { source: "B", destination: "C" },
    ]);
  });

  test("both filters throws", async () => {
    await expect(
      repo.getInvocations({ sourceBehaviorId: "A", destinationBehaviorId: "B" }),
    ).rejects.toThrow(/at most one/);
  });
});
