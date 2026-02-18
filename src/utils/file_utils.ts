/**
 * File system utilities for reading and writing files
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { mkdir } from 'fs/promises';

/**
 * Reads a JSON file and parses it with type safety
 *
 * @param filePath - Path to the JSON file
 * @returns Parsed JSON data
 * @throws Error if file doesn't exist or JSON is invalid
 *
 * @example
 * ```typescript
 * interface Config { name: string; version: string; }
 * const config = readJsonFile<Config>('config.json');
 * ```
 */
export function readJsonFile<T = unknown>(filePath: string): T {
  const absolutePath = resolve(filePath);

  if (!existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  const content = readFileSync(absolutePath, 'utf-8');

  try {
    return JSON.parse(content) as T;
  } catch (error) {
    throw new Error(
      `Invalid JSON in file ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Writes data to a JSON file with pretty formatting
 *
 * @param filePath - Path to the JSON file
 * @param data - Data to write
 * @param options - Write options
 * @throws Error if write fails
 *
 * @example
 * ```typescript
 * writeJsonFile('output.json', { name: 'test' });
 * ```
 */
export async function writeJsonFile(
  filePath: string,
  data: unknown,
  options: { createDirs?: boolean; spaces?: number } = {}
): Promise<void> {
  const { createDirs = true, spaces = 2 } = options;
  const absolutePath = resolve(filePath);

  // Create parent directories if needed
  if (createDirs) {
    const dir = dirname(absolutePath);
    await mkdir(dir, { recursive: true });
  }

  const content = JSON.stringify(data, null, spaces);
  writeFileSync(absolutePath, content, 'utf-8');
}

/**
 * Reads a text file
 *
 * @param filePath - Path to the file
 * @returns File content as string
 * @throws Error if file doesn't exist
 *
 * @example
 * ```typescript
 * const content = readTextFile('README.md');
 * ```
 */
export function readTextFile(filePath: string): string {
  const absolutePath = resolve(filePath);

  if (!existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  return readFileSync(absolutePath, 'utf-8');
}

/**
 * Writes content to a text file
 *
 * @param filePath - Path to the file
 * @param content - Content to write
 * @param options - Write options
 * @throws Error if write fails
 *
 * @example
 * ```typescript
 * await writeTextFile('output.txt', 'Hello, world!');
 * ```
 */
export async function writeTextFile(
  filePath: string,
  content: string,
  options: { createDirs?: boolean } = {}
): Promise<void> {
  const { createDirs = true } = options;
  const absolutePath = resolve(filePath);

  // Create parent directories if needed
  if (createDirs) {
    const dir = dirname(absolutePath);
    await mkdir(dir, { recursive: true });
  }

  writeFileSync(absolutePath, content, 'utf-8');
}

/**
 * Checks if a file exists
 *
 * @param filePath - Path to check
 * @returns True if file exists
 *
 * @example
 * ```typescript
 * if (fileExists('config.json')) {
 *   const config = readJsonFile('config.json');
 * }
 * ```
 */
export function fileExists(filePath: string): boolean {
  return existsSync(resolve(filePath));
}
