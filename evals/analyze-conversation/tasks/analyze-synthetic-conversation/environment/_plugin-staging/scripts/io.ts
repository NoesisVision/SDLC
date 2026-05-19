import { existsSync, unlinkSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import type { z } from "zod";

export function parseArgs(
  expected: string[],
  optional: string[] = [],
): Record<string, string> {
  const args = process.argv.slice(2);
  const result: Record<string, string> = {};

  let positionalIndex = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const value = args[i + 1];
      if (value === undefined) {
        exitError(`Missing value for --${key}`);
      }
      result[key] = value;
      i++;
    } else {
      if (positionalIndex >= expected.length) {
        exitError(
          `Unexpected argument: ${args[i]}. Expected: ${[...expected, ...optional.map((o) => `[${o}]`)].join(" ")}`,
        );
      }
      result[expected[positionalIndex]] = args[i];
      positionalIndex++;
    }
  }

  for (const name of expected) {
    if (!(name in result)) {
      exitError(
        `Missing required argument: ${name}. Expected: ${[...expected, ...optional.map((o) => `[${o}]`)].join(" ")}`,
      );
    }
  }

  return result;
}

export function requireFile(path: string): void {
  if (!existsSync(path)) {
    exitError(`File not found: ${path}`);
  }
}

export function requireDir(path: string): void {
  if (!existsSync(path)) {
    exitError(`Directory not found: ${path}`);
  }
}

export async function readJson<T>(schema: z.ZodType<T>, path: string): Promise<T> {
  const content = await readFile(path, "utf-8");
  const data = JSON.parse(content);
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  exitError(
    `Invalid JSON in ${path}: ${JSON.stringify(result.error.issues)}`,
  );
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

export function outputResult(data: object): void {
  process.stdout.write(JSON.stringify(data));
}

export function deleteFile(path: string): void {
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

export function exitError(message: string): never {
  process.stderr.write(message);
  process.exit(1);
}
