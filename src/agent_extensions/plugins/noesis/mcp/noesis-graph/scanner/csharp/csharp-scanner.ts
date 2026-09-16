import { readFile, readdir } from "fs/promises";
import { join, relative } from "path";
import { DDD_ANNOTATIONS, annotationToBlockType, type DddAnnotation } from "../ddd-annotations.js";
import {
  shouldSkipDir,
  type BehaviorMatch,
  type LanguageScanner,
  type ScannedFile,
  type ScannedType,
} from "../language-scanner.js";

/*
 * The C# scanner: regular expressions over `.cs` files. A type is a building
 * block when it carries one of the `[Ddd*]` attributes; its public methods are
 * behaviors, `[DomainBehavior("...")]` renames one and `[Actor("...")]` names
 * who triggers it.
 */

const CONCURRENCY_LIMIT = 10;

const SKIPPED_DIRS = new Set(["bin", "obj"]);

const ANNOTATION_WITH_TYPE_PATTERN = new RegExp(
  `\\[(${DDD_ANNOTATIONS.join("|")})(Attribute)?(?:\\s*\\(\\s*"([^"]*)"\\s*\\))?\\s*\\]` +
    `[\\s\\S]*?(?:class|struct|interface|enum|record|delegate)\\s+(\\w+)`,
  "g"
);

const NAMESPACE_PATTERN = /^\s*namespace\s+([\w.]+)\s*[;{]/m;

const TYPE_KIND_PATTERN = /\b(class|struct|interface|enum|record|delegate)\b/;

const DISQUALIFYING_METHOD_KEYWORDS =
  /\b(class|struct|interface|enum|record|delegate|event|operator|namespace|using)\b/;

const DOMAIN_BEHAVIOR_ATTRIBUTE_PATTERN =
  /\[DomainBehavior(?:Attribute)?(?:\s*\(\s*"([^"]*)"\s*\))?\s*]/;

const ACTOR_ATTRIBUTE_PATTERN = /\[Actor(?:Attribute)?\s*\(\s*"([^"]*)"\s*\)\s*]/;

const TECHNICAL_METHOD_NAMES = new Set([
  "Equals",
  "GetHashCode",
  "GetType",
  "ToString",
  "Finalize",
  "MemberwiseClone",
  "Deconstruct",
  "PrintMembers",
]);

export interface AnnotationMatch {
  annotation: DddAnnotation;
  nameOverride: string | null;
  typeName: string;
  behaviors: BehaviorMatch[];
}

export const csharpScanner: LanguageScanner = {
  language: "csharp",
  detect: async (projectDir) => (await findCsFiles(projectDir)).length > 0,
  scan: scanCsFiles,
};

export async function scanCsFiles(projectDir: string): Promise<ScannedFile[]> {
  const csFiles = await findCsFiles(projectDir);
  const results: ScannedFile[] = [];

  const batches = toBatches(csFiles, CONCURRENCY_LIMIT);
  for (const batch of batches) {
    const batchResults = await Promise.all(
      batch.map(async (absPath) => {
        const content = await readFile(absPath, "utf-8");
        const namespace = extractNamespace(content) ?? "";
        const types = parseAnnotations(content).map(toScannedType);
        const relativePath = relative(projectDir, absPath);
        return { language: "csharp" as const, relativePath, namespace, types, content };
      })
    );
    results.push(...batchResults);
  }

  return results;
}

export function extractNamespace(content: string): string | null {
  const match = NAMESPACE_PATTERN.exec(content);
  return match ? match[1] : null;
}

export function parseAnnotations(content: string): AnnotationMatch[] {
  const matches: AnnotationMatch[] = [];
  ANNOTATION_WITH_TYPE_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = ANNOTATION_WITH_TYPE_PATTERN.exec(content)) !== null) {
    const annotation = match[1] as DddAnnotation;
    const nameOverride = match[3] ?? null;
    const typeName = match[4] ?? "";
    if (typeName === "") continue;

    const typeKindMatch = TYPE_KIND_PATTERN.exec(match[0]);
    const typeKind = typeKindMatch ? typeKindMatch[1] : "";
    const behaviors = extractBehaviors(content, match.index + match[0].length, typeName, typeKind);
    matches.push({ annotation, nameOverride, typeName, behaviors });
  }

  return matches;
}

export function extractBehaviors(
  content: string,
  searchStart: number,
  typeName: string,
  typeKind: string
): BehaviorMatch[] {
  if (typeKind === "enum" || typeKind === "delegate" || typeKind === "") return [];

  const bodyStart = findTypeBodyStart(content, searchStart);
  if (bodyStart === -1) return [];
  const bodyEnd = findMatchingBrace(content, bodyStart);
  if (bodyEnd === -1) return [];

  const body = content.substring(bodyStart + 1, bodyEnd);
  return parsePublicMethods(body, typeName, typeKind);
}

function toScannedType(match: AnnotationMatch): ScannedType {
  return {
    typeName: match.typeName,
    blockType: annotationToBlockType(match.annotation),
    nameOverride: match.nameOverride,
    behaviors: match.behaviors,
    // C# properties are not read yet; see the scanner feedback in NOE-5.
    properties: [],
  };
}

function findTypeBodyStart(content: string, from: number): number {
  for (let i = from; i < content.length; i++) {
    const ch = content[i];
    if (ch === "{") return i;
    if (ch === ";") return -1;
  }
  return -1;
}

function findMatchingBrace(content: string, start: number): number {
  if (content[start] !== "{") return -1;
  let depth = 0;
  for (let i = start; i < content.length; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parsePublicMethods(body: string, typeName: string, typeKind: string): BehaviorMatch[] {
  const withoutComments = stripComments(body);
  const flattened = flattenBraceBlocks(withoutComments);
  const statements = flattened.split(";");

  const seen = new Set<string>();
  const methods: BehaviorMatch[] = [];
  for (const stmt of statements) {
    const method = parseMethodStatement(stmt, typeName, typeKind);
    if (!method) continue;
    const key = `${method.methodName}|${method.nameOverride ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    methods.push(method);
  }
  return methods;
}

function stripComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function flattenBraceBlocks(content: string): string {
  let result = "";
  let depth = 0;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === "{") {
      if (depth === 0) result += ";";
      depth++;
    } else if (ch === "}") {
      if (depth > 0) depth--;
    } else if (depth === 0) {
      result += ch;
    }
  }
  return result;
}

function parseMethodStatement(
  stmt: string,
  typeName: string,
  typeKind: string
): BehaviorMatch | null {
  const attrMatch = DOMAIN_BEHAVIOR_ATTRIBUTE_PATTERN.exec(stmt);
  const nameOverride = attrMatch?.[1] ?? null;
  const actorMatch = ACTOR_ATTRIBUTE_PATTERN.exec(stmt);
  const actor = actorMatch?.[1] ?? null;

  const withoutAttrs = stmt.replace(/\[[^\]]*]/g, " ");

  if (DISQUALIFYING_METHOD_KEYWORDS.test(withoutAttrs)) return null;

  const isInterface = typeKind === "interface";
  if (!isInterface && !/\bpublic\b/.test(withoutAttrs)) return null;
  if (isInterface && /\b(private|internal|protected)\b/.test(withoutAttrs)) return null;

  const parenIdx = withoutAttrs.indexOf("(");
  if (parenIdx === -1) return null;

  const beforeParen = withoutAttrs.substring(0, parenIdx);
  if (beforeParen.includes("=")) return null;

  const nameMatch = /(\w+)\s*$/.exec(beforeParen);
  if (!nameMatch) return null;

  const methodName = nameMatch[1];
  if (methodName === typeName) return null;
  if (methodName === "this" || methodName === "base") return null;
  if (TECHNICAL_METHOD_NAMES.has(methodName)) return null;

  return { methodName, nameOverride, actor };
}

async function findCsFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  await walkDir(dir, results);
  return results;
}

async function walkDir(dir: string, results: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name, SKIPPED_DIRS)) continue;
      await walkDir(fullPath, results);
    } else if (entry.name.endsWith(".cs")) {
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
