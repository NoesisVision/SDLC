import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveSkillWorkingDir } from "./resolve-working-dir.js";

const tmpRoot = mkdtempSync(join(tmpdir(), "noesis-resolve-wd-"));
const SCRIPT = join(import.meta.dirname, "resolve-working-dir.ts");

function runScript(env: NodeJS.ProcessEnv, ...args: string[]) {
  const result = Bun.spawnSync(["bun", "run", SCRIPT, ...args], {
    env: env as Record<string, string>,
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("resolveSkillWorkingDir", () => {
  test("creates <base>/<skillName>/<executionId>", () => {
    const result = resolveSkillWorkingDir(
      "noesis:create-design-doc",
      "auth-system",
      tmpRoot,
    );
    expect(result.status).toBe("Ok");
    expect(result.skill_name).toBe("noesis:create-design-doc");
    expect(result.execution_id).toBe("auth-system");
    expect(result.working_dir).toBe(
      join(tmpRoot, "noesis:create-design-doc", "auth-system"),
    );
    expect(existsSync(result.working_dir)).toBe(true);
    expect(statSync(result.working_dir).isDirectory()).toBe(true);
  });
});

describe("resolve-working-dir script", () => {
  test("prints the resolved JSON to stdout", () => {
    const result = runScript(
      {
        ...process.env,
        CLAUDE_PLUGIN_DATA: join(tmpRoot, "data"),
        CLAUDE_PROJECT_DIR: "/some/project",
      },
      "noesis:implement-design-doc",
      "exec-42",
    );
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.status).toBe("Ok");
    expect(payload.skill_name).toBe("noesis:implement-design-doc");
    expect(payload.execution_id).toBe("exec-42");
    expect(payload.working_dir).toContain("noesis:implement-design-doc");
    expect(payload.working_dir).toContain("exec-42");
    expect(existsSync(payload.working_dir)).toBe(true);
  });

  test("exits with code 1 when arguments are missing", () => {
    const result = runScript({ ...process.env });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing required argument");
  });
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});
