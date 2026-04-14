import { describe, expect, test, afterEach } from "bun:test";
import { existsSync, readFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initKnowledgeGraph } from "./init-knowledge-graph.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `init_kg_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("initKnowledgeGraph", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates empty knowledge graph file", () => {
    tmpDir = makeTmpDir();
    const path = join(tmpDir, "kg.json");
    initKnowledgeGraph(path);

    expect(existsSync(path)).toBe(true);
    const data = JSON.parse(readFileSync(path, "utf-8"));
    expect(data).toEqual({ conversations: [], topics: [], decisions: [] });
  });

  test("creates parent directories if needed", () => {
    tmpDir = makeTmpDir();
    const path = join(tmpDir, "nested", "dir", "kg.json");
    initKnowledgeGraph(path);

    expect(existsSync(path)).toBe(true);
  });
});
