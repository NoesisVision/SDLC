import "reflect-metadata";
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { DatabaseService } from "./database.service.js";
import { DATA_DIR } from "../config/config.module.js";

describe("DatabaseService", () => {
  let module: TestingModule;
  let service: DatabaseService;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "noesis-db-test-"));

    module = await Test.createTestingModule({
      providers: [
        DatabaseService,
        { provide: DATA_DIR, useValue: tmpDir },
      ],
    }).compile();

    service = module.get(DatabaseService);
  });

  afterEach(async () => {
    await module.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("getConnection throws before initialization", () => {
    expect(() => service.getConnection()).toThrow("Database not initialized");
  });

  test("getConnection returns working connection after init", () => {
    service.onModuleInit();
    const conn = service.getConnection();
    const result = conn.querySync("RETURN 1 AS x");
    expect(
      (result as { getAllSync(): unknown[] }).getAllSync(),
    ).toEqual([{ x: 1 }]);
  });

  test("re-initialization after destroy works", async () => {
    service.onModuleInit();
    await service.onModuleDestroy();
    expect(() => service.getConnection()).toThrow("Database not initialized");

    service.onModuleInit();
    const conn = service.getConnection();
    const result = conn.querySync("RETURN 2 AS x");
    expect(
      (result as { getAllSync(): unknown[] }).getAllSync(),
    ).toEqual([{ x: 2 }]);
  });
});
