import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initDatabase, getConnection, closeDatabase } from "./db.js";

describe("db", () => {
  let tmpDir: string;

  afterEach(async () => {
    await closeDatabase();
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("getConnection throws before initialization", () => {
    expect(() => getConnection()).toThrow("Database not initialized");
  });

  test("initDatabase creates a working connection", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "noesis-db-test-"));
    const conn = initDatabase(tmpDir);
    const result = conn.querySync("RETURN 1 AS x");
    expect((result as { getAllSync(): unknown[] }).getAllSync()).toEqual([{ x: 1 }]);
  });

  test("getConnection returns connection after init", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "noesis-db-test-"));
    initDatabase(tmpDir);
    const conn = getConnection();
    const result = conn.querySync("RETURN 42 AS answer");
    expect((result as { getAllSync(): unknown[] }).getAllSync()).toEqual([{ answer: 42 }]);
  });

  test("closeDatabase allows re-initialization", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "noesis-db-test-"));
    initDatabase(tmpDir);
    await closeDatabase();
    expect(() => getConnection()).toThrow("Database not initialized");

    const conn = initDatabase(tmpDir);
    const result = conn.querySync("RETURN 2 AS x");
    expect((result as { getAllSync(): unknown[] }).getAllSync()).toEqual([{ x: 2 }]);
  });
});
