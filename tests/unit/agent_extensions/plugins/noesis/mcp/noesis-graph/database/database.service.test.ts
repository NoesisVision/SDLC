import "reflect-metadata";
import { describe, test, beforeEach, afterEach, expect } from "bun:test";
import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { and, given, then, when } from "@tests/bdd.js";
import { DatabaseService } from "@noesis/mcp/noesis-graph/database/database.service.js";
import { DATA_DIR } from "@noesis/mcp/noesis-graph/config/config.module.js";

describe("DatabaseService — local Kuzu graph database access", () => {
  let module: TestingModule;
  let service: DatabaseService;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "noesis-db-test-"));
    module = await Test.createTestingModule({
      providers: [DatabaseService, { provide: DATA_DIR, useValue: tmpDir }],
    }).compile();
    service = module.get(DatabaseService);
  });

  afterEach(async () => {
    await module.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("an uninitialized service refuses to expose its connection", async () => {
    let caught: Error | null = null;

    await given("a DatabaseService whose lifecycle hooks have not run", () => {});
    await when("a caller asks for the underlying connection", () => {
      try {
        service.getConnection();
      } catch (e) {
        caught = e as Error;
      }
    });
    await then("the request fails with an explicit not-initialized error", () => {
      expect(caught?.message).toMatch(/Database not initialized/);
    });
  });

  test("a freshly initialized service answers cypher round-trips", async () => {
    let rows: Array<{ x: number | bigint }> = [];

    await given("a DatabaseService that has just completed its module init", () => {
      service.onModuleInit();
    });
    await when("a trivial RETURN query is executed", async () => {
      rows = await service.query<{ x: number | bigint }>("RETURN 1 AS x");
    });
    await then("the connection yields a single row carrying the literal", () => {
      expect(rows.map((r) => Number(r.x))).toEqual([1]);
    });
  });

  test("parameterized cypher uses prepared statements transparently", async () => {
    let rows: Array<{ label: string }> = [];

    await given(
      "a database holding two rows of a Thing node table",
      async () => {
        service.onModuleInit();
        const conn = service.getConnection();
        await conn.query(
          "CREATE NODE TABLE Thing(id STRING, label STRING, PRIMARY KEY(id))",
        );
        await conn.query("CREATE (:Thing {id: 'a', label: 'alpha'})");
        await conn.query("CREATE (:Thing {id: 'b', label: 'beta'})");
      },
    );
    await when("a parameterized lookup queries the row by id", async () => {
      rows = await service.query<{ label: string }>(
        "MATCH (t:Thing) WHERE t.id = $id RETURN t.label AS label",
        { id: "b" },
      );
    });
    await then("only the matching row is returned with its label", () => {
      expect(rows).toEqual([{ label: "beta" }]);
    });
  });

  test("destroying an initialized service releases its connection", async () => {
    let postDestroyError: Error | null = null;

    await given("a DatabaseService that has been initialized once", () => {
      service.onModuleInit();
    });
    await when("the module destroy hook tears it down", async () => {
      await service.onModuleDestroy();
    });
    await then(
      "further connection access fails with the not-initialized error",
      () => {
        try {
          service.getConnection();
        } catch (e) {
          postDestroyError = e as Error;
        }
        expect(postDestroyError?.message).toMatch(/Database not initialized/);
      },
    );
  });
});
