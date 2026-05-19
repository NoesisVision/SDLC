import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import {
  ensureTmpDir,
  projectKeyFor,
  resolveScriptTmpDir,
  resolveWorkingDir,
  scopeDataDirToProject,
} from "./plugin-paths.js";

const tmpRoot = mkdtempSync(join(tmpdir(), "noesis-plugin-paths-"));

describe("projectKeyFor", () => {
  test("is stable for the same path", () => {
    const a = projectKeyFor("/some/project");
    const b = projectKeyFor("/some/project");
    expect(a).toBe(b);
  });

  test("differs across distinct paths", () => {
    expect(projectKeyFor("/a")).not.toBe(projectKeyFor("/b"));
  });

  test("normalises relative segments", () => {
    expect(projectKeyFor("/a/b/../b")).toBe(projectKeyFor("/a/b"));
  });

  test("returns a 12-char hex string", () => {
    const key = projectKeyFor("/x");
    expect(key).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("scopeDataDirToProject", () => {
  test("nests projects/<key> under the base", () => {
    const scoped = scopeDataDirToProject("/base", "/proj");
    expect(scoped).toBe(resolve("/base", "projects", projectKeyFor("/proj")));
  });
});

describe("ensureTmpDir", () => {
  test("creates a tmp/ subdirectory under dataDir", () => {
    const dataDir = join(tmpRoot, "ensure-tmp");
    const tmp = ensureTmpDir(dataDir);
    expect(tmp).toBe(resolve(dataDir, "tmp"));
    expect(existsSync(tmp)).toBe(true);
    expect(statSync(tmp).isDirectory()).toBe(true);
  });
});

describe("resolveScriptTmpDir", () => {
  test("uses CLAUDE_PLUGIN_DATA + CLAUDE_PROJECT_DIR when both set", () => {
    const baseData = join(tmpRoot, "data");
    const projectDir = "/some/proj";
    const result = resolveScriptTmpDir({
      CLAUDE_PLUGIN_DATA: baseData,
      CLAUDE_PROJECT_DIR: projectDir,
    });
    expect(result).toBe(
      resolve(baseData, "projects", projectKeyFor(projectDir), "tmp"),
    );
    expect(existsSync(result)).toBe(true);
  });

  test("accepts NOESIS_PROJECT_DIR as fallback for project", () => {
    const baseData = join(tmpRoot, "data2");
    const projectDir = "/other/proj";
    const result = resolveScriptTmpDir({
      CLAUDE_PLUGIN_DATA: baseData,
      NOESIS_PROJECT_DIR: projectDir,
    });
    expect(result).toBe(
      resolve(baseData, "projects", projectKeyFor(projectDir), "tmp"),
    );
  });

  test("falls back to os.tmpdir/noesis when env vars missing", () => {
    const result = resolveScriptTmpDir({});
    expect(result).toBe(resolve(tmpdir(), "noesis"));
    expect(existsSync(result)).toBe(true);
  });
});

describe("resolveWorkingDir", () => {
  test("nests <skillName>/<executionId> under the supplied base", () => {
    const base = join(tmpRoot, "wd-base");
    const dir = resolveWorkingDir("noesis:demo-skill", "exec-123", base);
    expect(dir).toBe(resolve(base, "noesis:demo-skill", "exec-123"));
    expect(existsSync(dir)).toBe(true);
    expect(statSync(dir).isDirectory()).toBe(true);
  });

  test("reuses the same directory across calls with the same id", () => {
    const base = join(tmpRoot, "wd-stable");
    const first = resolveWorkingDir("skill", "stable-id", base);
    const second = resolveWorkingDir("skill", "stable-id", base);
    expect(second).toBe(first);
  });
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});
