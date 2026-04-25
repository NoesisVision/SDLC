import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { randomUUID } from "crypto";

const FALLBACK_DIR = join(tmpdir(), "noesis-graph");
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

let outputDir = FALLBACK_DIR;

export interface ToolResponse {
  [x: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function configureToolOutputDir(dir: string): void {
  outputDir = resolve(dir);
}

export function pruneStaleOutputs(maxAgeMs: number = DEFAULT_TTL_MS): void {
  let entries: string[];
  try {
    entries = readdirSync(outputDir);
  } catch {
    return;
  }
  const cutoff = Date.now() - maxAgeMs;
  for (const entry of entries) {
    const file = join(outputDir, entry);
    try {
      if (statSync(file).mtimeMs < cutoff) {
        unlinkSync(file);
      }
    } catch {
      // skip files that vanish or can't be inspected
    }
  }
}

export async function runInlineJsonTool<T>(
  fn: () => Promise<T>,
): Promise<ToolResponse> {
  try {
    const result = await fn();
    return inlineJson(result);
  } catch (err: unknown) {
    return toolError(err);
  }
}

export async function runFileOutputTool<T>(
  toolName: string,
  fn: () => Promise<T>,
  format: (result: T) => string,
  extension: string = "md",
): Promise<ToolResponse> {
  try {
    const result = await fn();
    return writeOutputFile(toolName, format(result), extension);
  } catch (err: unknown) {
    return toolError(err);
  }
}

function inlineJson(value: unknown): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function toolError(err: unknown): ToolResponse {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: message }], isError: true };
}

function writeOutputFile(
  toolName: string,
  content: string,
  extension: string,
): ToolResponse {
  mkdirSync(outputDir, { recursive: true, mode: DIR_MODE });
  const file = join(outputDir, `${toolName}-${randomUUID()}.${extension}`);
  writeFileSync(file, content, { encoding: "utf-8", mode: FILE_MODE });
  const summary = {
    status: "Ok",
    message: `Result written to ${file}. Read it with the Read tool.`,
    file,
    bytes: Buffer.byteLength(content, "utf-8"),
  };
  return inlineJson(summary);
}
