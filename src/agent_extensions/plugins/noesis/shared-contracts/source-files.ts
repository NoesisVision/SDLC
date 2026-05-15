import { createHash } from "crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, extname, join, resolve, sep } from "path";
import { z } from "zod";

const NOESIS_DIR_NAME = "noesis";

export const SourceFileKindSchema = z.enum([
  "conversation",
  "document",
  "topic",
  "decision",
  "design_doc",
]);
export type SourceFileKind = z.infer<typeof SourceFileKindSchema>;

export const SOURCE_FILE_KINDS: readonly SourceFileKind[] = [
  "conversation",
  "document",
  "topic",
  "decision",
  "design_doc",
];

export const SOURCE_FILE_EXTENSIONS = [".json"] as const;
export type SourceFileExtension = (typeof SOURCE_FILE_EXTENSIONS)[number];

export const SUBDIR_FOR_KIND: Record<SourceFileKind, string> = {
  conversation: "conversations",
  document: "documents",
  topic: "topics",
  decision: "decisions",
  design_doc: "design-docs",
};

export const KIND_FOR_SUBDIR: Record<string, SourceFileKind> = {
  conversations: "conversation",
  documents: "document",
  topics: "topic",
  decisions: "decision",
  "design-docs": "design_doc",
};

const ID_FIELD_FOR_KIND: Record<SourceFileKind, string> = {
  conversation: "conversation_id",
  document: "document_id",
  topic: "topic_id",
  decision: "decision_id",
  design_doc: "design_doc_id",
};

const SLUG_MAX = 30;
const ID_SUFFIX_MIN = 8;

export function noesisRoot(projectDir: string): string {
  return resolve(projectDir, NOESIS_DIR_NAME);
}

export function noesisSubdirPath(projectDir: string, kind: SourceFileKind): string {
  return resolve(noesisRoot(projectDir), SUBDIR_FOR_KIND[kind]);
}

export function canonicalFilename(
  projectDir: string,
  kind: SourceFileKind,
  id: string,
  name: string,
): string {
  const slug = slugifyForFilename(name).slice(0, SLUG_MAX);
  const idSuffix = pickUniqueIdSuffix(projectDir, kind, id);
  const stem = slug === "" ? idSuffix : `${slug}-${idSuffix}`;
  return `${stem}.json`;
}

export function canonicalPath(
  projectDir: string,
  kind: SourceFileKind,
  id: string,
  name: string,
): string {
  return resolve(
    noesisSubdirPath(projectDir, kind),
    canonicalFilename(projectDir, kind, id, name),
  );
}

export function findFileById(
  projectDir: string,
  kind: SourceFileKind,
  id: string,
  exclude?: ReadonlySet<string>,
): string | null {
  const dir = noesisSubdirPath(projectDir, kind);
  if (!existsSync(dir)) return null;
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const abs = resolve(dir, entry);
    if (exclude !== undefined && exclude.has(abs)) continue;
    const fileId = readIdFromJsonFile(abs, kind);
    if (fileId === id) return abs;
  }
  return null;
}

export function conversationJsonPath(projectDir: string, id: string, name: string): string {
  return canonicalPath(projectDir, "conversation", id, name);
}

export function documentJsonPath(projectDir: string, id: string, name: string): string {
  return canonicalPath(projectDir, "document", id, name);
}

export function topicJsonPath(projectDir: string, id: string, name: string): string {
  return canonicalPath(projectDir, "topic", id, name);
}

export function decisionJsonPath(projectDir: string, id: string, name: string): string {
  return canonicalPath(projectDir, "decision", id, name);
}

export function designDocCanonicalFilename(projectDir: string, id: string, name: string): string {
  return canonicalFilename(projectDir, "design_doc", id, name);
}

export function designDocCanonicalPath(projectDir: string, id: string, name: string): string {
  return canonicalPath(projectDir, "design_doc", id, name);
}

export function findConversationJsonById(projectDir: string, id: string): string | null {
  return findFileById(projectDir, "conversation", id);
}

export function findDocumentJsonById(projectDir: string, id: string): string | null {
  return findFileById(projectDir, "document", id);
}

export function findTopicJsonById(projectDir: string, id: string): string | null {
  return findFileById(projectDir, "topic", id);
}

export function findDecisionJsonById(projectDir: string, id: string): string | null {
  return findFileById(projectDir, "decision", id);
}

export function findDesignDocFileById(
  projectDir: string,
  id: string,
  exclude?: ReadonlySet<string>,
): string | null {
  return findFileById(projectDir, "design_doc", id, exclude);
}

export function readIdFromJsonFile(absPath: string, kind: SourceFileKind): string | null {
  if (!existsSync(absPath)) return null;
  try {
    const raw = readFileSync(absPath, "utf-8");
    return readIdFromJson(raw, kind);
  } catch {
    return null;
  }
}

export function readIdFromDesignDocFile(absPath: string): string | null {
  return readIdFromJsonFile(absPath, "design_doc");
}

export function computeContentSha(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function computeFileSha(absPath: string): string {
  return computeContentSha(readFileSync(absPath));
}

export function readSourceFile<T>(absPath: string, schema: z.ZodType<T>): T {
  const raw = readFileSync(absPath, "utf-8");
  const parsed = JSON.parse(raw);
  return schema.parse(parsed);
}

export function writeSourceFile<S extends z.ZodType>(
  absPath: string,
  data: z.input<S>,
  schema: S
): void {
  const validated = schema.parse(data);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, `${JSON.stringify(validated, null, 2)}\n`, "utf-8");
}

export function isUnderNoesisRoot(projectDir: string, absPath: string): boolean {
  const root = noesisRoot(projectDir);
  const target = resolve(absPath);
  return target === root || target.startsWith(`${root}/`);
}

export interface DiscoveredSourceFile {
  kind: SourceFileKind;
  path: string;
}

export function discoverSourceFiles(projectDir: string): DiscoveredSourceFile[] {
  const out: DiscoveredSourceFile[] = [];
  for (const kind of SOURCE_FILE_KINDS) {
    const dir = noesisSubdirPath(projectDir, kind);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      try {
        if (!statSync(full).isFile()) continue;
      } catch {
        continue;
      }
      if (!hasValidSourceFileExtension(entry)) continue;
      out.push({ kind, path: full });
    }
  }
  return out;
}

export function classifySourceFilePath(
  projectDir: string,
  absPath: string,
): { kind: SourceFileKind; subdirRelative: string; ext: SourceFileExtension } | null {
  const root = noesisRoot(projectDir);
  if (!absPath.startsWith(`${root}${sep}`)) return null;
  const rel = absPath.slice(root.length + 1);
  const segments = rel.split(sep);
  if (segments.length < 2) return null;
  const kind = KIND_FOR_SUBDIR[segments[0]];
  if (kind === undefined) return null;
  const ext = extname(segments[segments.length - 1]);
  if (!isSourceFileExtension(ext)) return null;
  return { kind, subdirRelative: segments.slice(1).join(sep), ext };
}

function slugifyForFilename(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function pickUniqueIdSuffix(
  projectDir: string,
  kind: SourceFileKind,
  id: string,
): string {
  const dir = noesisSubdirPath(projectDir, kind);
  const otherHexIds: string[] = [];
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".json")) continue;
      const fullId = readIdFromJsonFile(resolve(dir, entry), kind);
      if (fullId !== null && fullId !== id) {
        otherHexIds.push(stripDashes(fullId));
      }
    }
  }
  const idHex = stripDashes(id);
  for (let len = ID_SUFFIX_MIN; len <= idHex.length; len++) {
    const candidate = idHex.slice(-len);
    if (otherHexIds.every((other) => !other.endsWith(candidate))) {
      return candidate;
    }
  }
  return idHex;
}

function readIdFromJson(raw: string, kind: SourceFileKind): string | null {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const direct = parsed["id"];
  if (typeof direct === "string") return direct;
  const fieldName = ID_FIELD_FOR_KIND[kind];
  const namespaced = parsed[fieldName];
  return typeof namespaced === "string" ? namespaced : null;
}

function stripDashes(s: string): string {
  return s.replace(/-/g, "");
}

function hasValidSourceFileExtension(filename: string): boolean {
  return isSourceFileExtension(extname(filename));
}

function isSourceFileExtension(ext: string): ext is SourceFileExtension {
  return (SOURCE_FILE_EXTENSIONS as readonly string[]).includes(ext);
}
