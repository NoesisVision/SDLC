import { createHash } from "crypto";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";

const PROJECT_KEY_LENGTH = 12;
const TMP_DIR_NAME = "tmp";
const PROJECTS_DIR_NAME = "projects";
const FALLBACK_TMP_NAME = "noesis";
const DIR_MODE = 0o700;

export function projectKeyFor(projectDir: string): string {
  return createHash("sha256")
    .update(resolve(projectDir))
    .digest("hex")
    .slice(0, PROJECT_KEY_LENGTH);
}

export function scopeDataDirToProject(
  baseDataDir: string,
  projectDir: string,
): string {
  return resolve(baseDataDir, PROJECTS_DIR_NAME, projectKeyFor(projectDir));
}

export function ensureTmpDir(dataDir: string): string {
  const dir = resolve(dataDir, TMP_DIR_NAME);
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  return dir;
}

export function resolveScriptTmpDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const baseDataDir = env["CLAUDE_PLUGIN_DATA"];
  const projectDir =
    env["CLAUDE_PROJECT_DIR"] ?? env["NOESIS_PROJECT_DIR"];
  if (baseDataDir && projectDir) {
    return ensureTmpDir(scopeDataDirToProject(baseDataDir, projectDir));
  }
  const fallback = resolve(tmpdir(), FALLBACK_TMP_NAME);
  mkdirSync(fallback, { recursive: true, mode: DIR_MODE });
  return fallback;
}
