import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { z } from "zod";

const SCRIPTS_DIR = import.meta.dirname;
const IO_SCRIPT = join(SCRIPTS_DIR, "io.ts");
const tmpDir = mkdtempSync(join(import.meta.dirname, ".tmp-test-"));

function runScript(code: string): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["bun", "-e", code], { cwd: import.meta.dirname });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("readJson", () => {
  test("returns validated data for valid JSON file", async () => {
    const schema = z.object({ name: z.string(), age: z.int() });
    const filePath = join(tmpDir, "valid.json");
    writeFileSync(filePath, JSON.stringify({ name: "Alice", age: 30 }));

    const { readJson } = await import("./io.js");
    const result = await readJson(schema, filePath);

    expect(result).toEqual({ name: "Alice", age: 30 });
  });

  test("exits with code 1 and stderr message when JSON does not match schema", () => {
    const filePath = join(tmpDir, "invalid_schema.json");
    writeFileSync(filePath, JSON.stringify({ name: 123 }));

    const result = runScript(`
      import { readJson } from '${IO_SCRIPT}';
      import { z } from 'zod';
      await readJson(z.object({ name: z.string() }), '${filePath}');
    `);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Invalid JSON");
    expect(result.stderr).toContain(filePath);
  });

  test("exits with code 1 when file contains malformed JSON", () => {
    const filePath = join(tmpDir, "malformed.json");
    writeFileSync(filePath, "not json {{{");

    const result = runScript(`
      import { readJson } from '${IO_SCRIPT}';
      import { z } from 'zod';
      await readJson(z.object({}), '${filePath}');
    `);

    expect(result.exitCode).not.toBe(0);
  });

  test("applies Zod defaults for missing optional fields", async () => {
    const schema = z.object({ name: z.string(), active: z.boolean().default(true) });
    const filePath = join(tmpDir, "defaults.json");
    writeFileSync(filePath, JSON.stringify({ name: "Bob" }));

    const { readJson } = await import("./io.js");
    const result = await readJson(schema, filePath);

    expect(result).toEqual({ name: "Bob", active: true });
  });
});

describe("writeJson", () => {
  test("writes JSON file that can be read back", async () => {
    const filePath = join(tmpDir, "output.json");
    const data = { items: [1, 2, 3], nested: { key: "value" } };

    const { writeJson } = await import("./io.js");
    await writeJson(filePath, data);

    const content = await Bun.file(filePath).text();
    expect(JSON.parse(content)).toEqual(data);
  });
});

describe("requireFile", () => {
  test("passes silently for existing file", () => {
    const filePath = join(tmpDir, "exists.txt");
    writeFileSync(filePath, "content");

    const result = runScript(`
      import { requireFile } from '${IO_SCRIPT}';
      requireFile('${filePath}');
      process.stdout.write('ok');
    `);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("ok");
  });

  test("exits with code 1 for missing file", () => {
    const result = runScript(`
      import { requireFile } from '${IO_SCRIPT}';
      requireFile('/nonexistent/path.txt');
    `);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("File not found");
  });
});

describe("requireDir", () => {
  test("passes silently for existing directory", () => {
    const result = runScript(`
      import { requireDir } from '${IO_SCRIPT}';
      requireDir('${tmpDir}');
      process.stdout.write('ok');
    `);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("ok");
  });

  test("exits with code 1 for missing directory", () => {
    const result = runScript(`
      import { requireDir } from '${IO_SCRIPT}';
      requireDir('/nonexistent/dir');
    `);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Directory not found");
  });
});

describe("outputResult", () => {
  test("writes JSON to stdout", () => {
    const result = runScript(`
      import { outputResult } from '${IO_SCRIPT}';
      outputResult({ status: "Ok", count: 5 });
    `);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ status: "Ok", count: 5 });
  });
});

describe("exitError", () => {
  test("writes message to stderr and exits with code 1", () => {
    const result = runScript(`
      import { exitError } from '${IO_SCRIPT}';
      exitError('something went wrong');
    `);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("something went wrong");
    expect(result.stdout).toBe("");
  });
});

describe("parseArgs", () => {
  test("extracts positional arguments", () => {
    const result = runScript(`
      import { parseArgs, outputResult } from '${IO_SCRIPT}';
      process.argv = ['bun', 'script.ts', '/path/to/file', 'my-id'];
      outputResult(parseArgs(['file_path', 'id']));
    `);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ file_path: "/path/to/file", id: "my-id" });
  });

  test("extracts named arguments with -- prefix", () => {
    const result = runScript(`
      import { parseArgs, outputResult } from '${IO_SCRIPT}';
      process.argv = ['bun', 'script.ts', '--parent-id', 'abc-123'];
      outputResult(parseArgs([]));
    `);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ "parent-id": "abc-123" });
  });

  test("handles mixed positional and named arguments", () => {
    const result = runScript(`
      import { parseArgs, outputResult } from '${IO_SCRIPT}';
      process.argv = ['bun', 'script.ts', '/path', '--topic-id', 'xyz'];
      outputResult(parseArgs(['file_path']));
    `);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ file_path: "/path", "topic-id": "xyz" });
  });

  test("exits with code 1 when required argument is missing", () => {
    const result = runScript(`
      import { parseArgs } from '${IO_SCRIPT}';
      process.argv = ['bun', 'script.ts'];
      parseArgs(['file_path', 'id']);
    `);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing required argument");
  });

  test("exits with code 1 for unexpected extra positional arguments", () => {
    const result = runScript(`
      import { parseArgs } from '${IO_SCRIPT}';
      process.argv = ['bun', 'script.ts', 'one', 'two', 'three'];
      parseArgs(['first']);
    `);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unexpected argument");
  });
});

// Cleanup
import { afterAll } from "bun:test";
afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});
