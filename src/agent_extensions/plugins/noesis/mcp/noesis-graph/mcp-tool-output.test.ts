import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  configureToolOutputDir,
  pruneStaleOutputs,
  runFileOutputTool,
  runInlineJsonTool,
} from "./mcp-tool-output.js";

const tmpDir = mkdtempSync(join(tmpdir(), "noesis-tool-output-"));

beforeAll(() => {
  configureToolOutputDir(tmpDir);
});

describe("runInlineJsonTool", () => {
  test("returns the result as inline JSON text content", async () => {
    const response = await runInlineJsonTool(async () => ({ ok: true, n: 7 }));
    expect(response.isError).toBeUndefined();
    expect(response.content).toHaveLength(1);
    expect(response.content[0].type).toBe("text");
    expect(JSON.parse(response.content[0].text)).toEqual({ ok: true, n: 7 });
  });

  test("returns isError on thrown errors", async () => {
    const response = await runInlineJsonTool(async () => {
      throw new Error("boom");
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toBe("boom");
  });
});

describe("runFileOutputTool", () => {
  test("writes formatted content to a tmp file and returns its path", async () => {
    const payload = "# Hello\n\nMarkdown body.";
    const response = await runFileOutputTool(
      "test_tool",
      async () => ({ value: payload }),
      (r) => r.value,
    );

    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0].text);
    expect(result.status).toBe("Ok");
    expect(typeof result.file).toBe("string");
    expect(result.file).toStartWith(tmpDir);
    expect(result.file).toContain("test_tool");
    expect(result.file).toEndWith(".md");
    expect(existsSync(result.file)).toBe(true);
    expect(readFileSync(result.file, "utf-8")).toBe(payload);
    expect(result.bytes).toBe(statSync(result.file).size);
  });

  test("respects the extension argument", async () => {
    const response = await runFileOutputTool(
      "json_tool",
      async () => ({ a: 1 }),
      (r) => JSON.stringify(r),
      "json",
    );
    const result = JSON.parse(response.content[0].text);
    expect(result.file).toEndWith(".json");
  });

  test("returns isError when the tool function throws", async () => {
    const response = await runFileOutputTool(
      "broken",
      async () => {
        throw new Error("nope");
      },
      () => "unused",
    );
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toBe("nope");
  });
});

describe("pruneStaleOutputs", () => {
  test("removes files older than the TTL and keeps fresher ones", () => {
    const stale = join(tmpDir, "stale.md");
    const fresh = join(tmpDir, "fresh.md");
    writeFileSync(stale, "old");
    writeFileSync(fresh, "new");
    const oldTime = (Date.now() - 48 * 60 * 60 * 1000) / 1000;
    utimesSync(stale, oldTime, oldTime);

    pruneStaleOutputs(24 * 60 * 60 * 1000);

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});
