import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { getWorkingDir } from "./working-dir.js";

const tmpDir = mkdtempSync(join(import.meta.dirname, ".tmp-test-"));
const SCRIPT = join(import.meta.dirname, "working-dir.ts");

function runScript(...args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["bun", "run", SCRIPT, ...args]);
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("getWorkingDir", () => {
  test("returns path with _work suffix next to transcript", () => {
    const result = getWorkingDir("/data/meetings/standup.md");
    expect(result).toBe("/data/meetings/standup_work");
  });

  test("handles transcript with multiple dots in name", () => {
    const result = getWorkingDir("/data/meeting.2024.01.md");
    expect(result).toBe("/data/meeting.2024.01_work");
  });

  test("handles transcript without extension", () => {
    const result = getWorkingDir("/data/transcript");
    expect(result).toBe("/data/transcript_work");
  });
});

describe("working_dir script", () => {
  test("creates directory and outputs JSON with status Ok", () => {
    const transcriptPath = join(tmpDir, "conversation.md");
    writeFileSync(transcriptPath, "# Meeting");

    const result = runScript(transcriptPath);
    const output = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(output.status).toBe("Ok");
    expect(output.working_dir).toBe(join(tmpDir, "conversation_work"));
    expect(existsSync(output.working_dir)).toBe(true);
  });

  test("exits with code 1 when transcript file does not exist", () => {
    const result = runScript("/nonexistent/path.md");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("File not found");
  });

  test("exits with code 1 when no arguments provided", () => {
    const result = runScript();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing required argument");
  });
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});
