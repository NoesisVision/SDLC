import { mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

export interface ToolResponse {
  [x: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

const OUTPUT_DIR = join(tmpdir(), "noesis-graph");

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
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const file = join(OUTPUT_DIR, `${toolName}-${randomUUID()}.${extension}`);
  writeFileSync(file, content, "utf-8");
  const summary = {
    status: "Ok",
    message: `Result written to ${file}. Read it with the Read tool.`,
    file,
    bytes: Buffer.byteLength(content, "utf-8"),
  };
  return inlineJson(summary);
}
