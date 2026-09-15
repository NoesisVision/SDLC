import { readFile, readdir } from "fs/promises";
import { join, relative, sep } from "path";
import { shouldSkipDir, type LanguageScanner, type ScannedFile } from "../language-scanner.js";
import { extractPackage, parseStereotypedTypes } from "./java-source.js";

/*
 * The Java scanner: the package is the namespace, a type is a building block
 * when it carries a stereotype annotation of the Noesis Java annotations
 * module, its public methods are behaviors. Build outputs and test sources are
 * left out.
 */

const CONCURRENCY_LIMIT = 10;

const SKIPPED_DIRS = new Set(["target", "build", "out"]);

/** Files that declare a package or a module rather than types. */
const IGNORED_FILES = new Set(["package-info.java", "module-info.java"]);

const TEST_SOURCE_ROOT = `${sep}src${sep}test${sep}`;

export const javaScanner: LanguageScanner = {
  language: "java",
  detect: async (projectDir) => (await findJavaFiles(projectDir)).length > 0,
  scan: scanJavaFiles,
};

export async function scanJavaFiles(projectDir: string): Promise<ScannedFile[]> {
  const javaFiles = await findJavaFiles(projectDir);
  const results: ScannedFile[] = [];

  for (const batch of toBatches(javaFiles, CONCURRENCY_LIMIT)) {
    const batchResults = await Promise.all(
      batch.map(async (absPath) => {
        const content = await readFile(absPath, "utf-8");
        return {
          language: "java" as const,
          relativePath: relative(projectDir, absPath),
          namespace: extractPackage(content) ?? "",
          types: parseStereotypedTypes(content),
          content,
        };
      })
    );
    results.push(...batchResults);
  }

  return results;
}

/** Every main-source `.java` file under the directory, sorted. */
export async function findJavaFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  await walkDir(dir, results);
  return results.filter((f) => !f.includes(TEST_SOURCE_ROOT)).sort((a, b) => a.localeCompare(b));
}

async function walkDir(dir: string, results: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name, SKIPPED_DIRS)) continue;
      await walkDir(fullPath, results);
    } else if (entry.name.endsWith(".java") && !IGNORED_FILES.has(entry.name)) {
      results.push(fullPath);
    }
  }
}

function toBatches<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
