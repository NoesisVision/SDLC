import { readFile, readdir } from "fs/promises";
import { join, relative } from "path";

/*
 * One scanner per language. Each reads the project's sources of its language
 * and reports, per file, the namespace and the annotated types with their
 * public methods; the hierarchy and the graph are language-neutral and built
 * by ScannerService from these reports. A language is present in a project
 * exactly when its scanner returns files.
 */

export type Language = "csharp" | "java";

export interface BehaviorMatch {
  methodName: string;
  /** A display name the code declares for the behavior, when the language supports one. */
  nameOverride: string | null;
  actor: string | null;
}

export interface ScannedType {
  typeName: string;
  /** The building block type as the model names it: "Aggregate", "Repository", ... */
  blockType: string;
  /** A display name the code declares for the block, when the language supports one. */
  nameOverride: string | null;
  behaviors: BehaviorMatch[];
}

export interface ScannedFile {
  language: Language;
  relativePath: string;
  /** The C# namespace or Java package; "" when the file declares none. */
  namespace: string;
  types: ScannedType[];
  content: string;
}

export interface LanguageScanner {
  readonly language: Language;
  /** Every source file of this language with what was found in it; none when the project has no such sources. */
  scan(projectDir: string): Promise<ScannedFile[]>;
}

/** What a language's source files look like on disk. */
export interface SourceFileSet {
  /** The file extension, with the dot. */
  extension: string;
  /** Directories skipped wherever they occur. */
  skippedDirs?: ReadonlySet<string>;
  /**
   * A build's output directories, skipped only beside one of its build files:
   * `target/` next to `pom.xml` is output, `adapter/out/` is a package.
   */
  buildOutput?: { dirs: ReadonlySet<string>; buildFiles: ReadonlySet<string> };
  /** File names that never declare types. */
  ignoredFiles?: ReadonlySet<string>;
}

/** What a language parser reads off one file's content. */
export type SourceParser = (content: string) => { namespace: string; types: ScannedType[] };

const CONCURRENCY_LIMIT = 10;

/** Source tree directories no language scanner enters. */
export const COMMON_SKIPPED_DIRS = new Set(["node_modules", ".git", ".vs", ".idea"]);

/** Every file of the set under the directory, sorted by path so a scan is deterministic. */
export async function findSourceFiles(dir: string, set: SourceFileSet): Promise<string[]> {
  const results: string[] = [];
  await walkDir(dir, set, results);
  return results.sort((a, b) => a.localeCompare(b));
}

/** The files read and parsed, a few at a time. */
export async function scanSourceFiles(
  projectDir: string,
  absPaths: string[],
  language: Language,
  parse: SourceParser
): Promise<ScannedFile[]> {
  const results: ScannedFile[] = [];
  for (const batch of toBatches(absPaths, CONCURRENCY_LIMIT)) {
    const batchResults = await Promise.all(
      batch.map(async (absPath) => {
        const content = await readFile(absPath, "utf-8");
        return {
          language,
          relativePath: relative(projectDir, absPath),
          ...parse(content),
          content,
        };
      })
    );
    results.push(...batchResults);
  }
  return results;
}

export function shouldSkipDir(name: string, languageSkipped?: ReadonlySet<string>): boolean {
  return (
    COMMON_SKIPPED_DIRS.has(name) || languageSkipped?.has(name) === true || name.startsWith(".")
  );
}

async function walkDir(dir: string, set: SourceFileSet, results: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  const buildOutputDirs = holdsBuildFile(entries, set) ? set.buildOutput?.dirs : undefined;
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name, set.skippedDirs) || buildOutputDirs?.has(entry.name)) continue;
      await walkDir(fullPath, set, results);
    } else if (entry.name.endsWith(set.extension) && !set.ignoredFiles?.has(entry.name)) {
      results.push(fullPath);
    }
  }
}

function holdsBuildFile(
  entries: { name: string; isFile(): boolean }[],
  set: SourceFileSet
): boolean {
  return entries.some(
    (entry) => entry.isFile() && set.buildOutput?.buildFiles.has(entry.name) === true
  );
}

function toBatches<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
