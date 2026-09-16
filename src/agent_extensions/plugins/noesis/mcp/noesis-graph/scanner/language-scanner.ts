/*
 * One scanner per language. Each reads the project's sources of its language
 * and reports, per file, the namespace and the annotated types with their
 * public methods; the hierarchy and the graph are language-neutral and built
 * by ScannerService from these reports.
 */

export type Language = "csharp" | "java";

export interface BehaviorMatch {
  methodName: string;
  /** A display name the code declares for the behavior, when the language supports one. */
  nameOverride: string | null;
  actor: string | null;
}

export interface PropertyMatch {
  name: string;
  /** The declared type as spelled in the source; null when the language does not state one. */
  type: string | null;
}

export interface ScannedType {
  typeName: string;
  /** The building block type as the model names it: "Aggregate", "Repository", ... */
  blockType: string;
  /** A display name the code declares for the block, when the language supports one. */
  nameOverride: string | null;
  behaviors: BehaviorMatch[];
  /** The data the type holds; empty when the scanner of its language does not read it yet. */
  properties: PropertyMatch[];
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
  /** Whether the project has sources of this language at all. */
  detect(projectDir: string): Promise<boolean>;
  /** Every source file of this language with what was found in it. */
  scan(projectDir: string): Promise<ScannedFile[]>;
}

/** Source tree directories no language scanner enters. */
export const COMMON_SKIPPED_DIRS = new Set(["node_modules", ".git", ".vs", ".idea"]);

export function shouldSkipDir(name: string, languageSkipped: ReadonlySet<string>): boolean {
  return COMMON_SKIPPED_DIRS.has(name) || languageSkipped.has(name) || name.startsWith(".");
}
