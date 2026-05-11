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

export const SOURCE_FILE_EXTENSIONS = [".md", ".json"] as const;
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

export function noesisRoot(projectDir: string): string {
  return resolve(projectDir, NOESIS_DIR_NAME);
}

export function noesisSubdirPath(projectDir: string, kind: SourceFileKind): string {
  return resolve(noesisRoot(projectDir), SUBDIR_FOR_KIND[kind]);
}

export function conversationMdPath(projectDir: string, id: string): string {
  return resolve(noesisSubdirPath(projectDir, "conversation"), `${id}.md`);
}

export function conversationJsonPath(projectDir: string, id: string): string {
  return resolve(noesisSubdirPath(projectDir, "conversation"), `${id}.json`);
}

export function documentMdPath(projectDir: string, id: string): string {
  return resolve(noesisSubdirPath(projectDir, "document"), `${id}.md`);
}

export function documentJsonPath(projectDir: string, id: string): string {
  return resolve(noesisSubdirPath(projectDir, "document"), `${id}.json`);
}

export function topicJsonPath(projectDir: string, id: string): string {
  return resolve(noesisSubdirPath(projectDir, "topic"), `${id}.json`);
}

export function decisionJsonPath(projectDir: string, id: string): string {
  return resolve(noesisSubdirPath(projectDir, "decision"), `${id}.json`);
}

const DESIGN_DOC_SLUG_MAX = 20;
const DESIGN_DOC_ID_SUFFIX_MIN = 8;

export function designDocCanonicalFilename(projectDir: string, id: string, name: string): string {
  const slug = slugifyForFilename(name).slice(0, DESIGN_DOC_SLUG_MAX);
  const idSuffix = pickUniqueIdSuffix(projectDir, id);
  return slug === "" ? `${idSuffix}.json` : `${slug}-${idSuffix}.json`;
}

export function designDocCanonicalPath(projectDir: string, id: string, name: string): string {
  return resolve(
    noesisSubdirPath(projectDir, "design_doc"),
    designDocCanonicalFilename(projectDir, id, name)
  );
}

export function findDesignDocFileById(
  projectDir: string,
  id: string,
  exclude?: ReadonlySet<string>
): string | null {
  const dir = noesisSubdirPath(projectDir, "design_doc");
  if (!existsSync(dir)) return null;
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const abs = resolve(dir, entry);
    if (exclude !== undefined && exclude.has(abs)) continue;
    const fileId = readIdFromDesignDocFile(abs);
    if (fileId === id) return abs;
  }
  return null;
}

export function readIdFromDesignDocFile(absPath: string): string | null {
  if (!existsSync(absPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(absPath, "utf-8")) as {
      id?: unknown;
    };
    return typeof parsed.id === "string" ? parsed.id : null;
  } catch {
    return null;
  }
}

export function designDocJsonPath(projectDir: string, id: string): string {
  return resolve(noesisSubdirPath(projectDir, "design_doc"), `${id}.json`);
}

function slugifyForFilename(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function pickUniqueIdSuffix(projectDir: string, id: string): string {
  const dir = noesisSubdirPath(projectDir, "design_doc");
  const otherHexIds: string[] = [];
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".json")) continue;
      const fullId = readIdFromDesignDocFile(resolve(dir, entry));
      if (fullId !== null && fullId !== id) {
        otherHexIds.push(stripDashes(fullId));
      }
    }
  }
  const idHex = stripDashes(id);
  for (let len = DESIGN_DOC_ID_SUFFIX_MIN; len <= idHex.length; len++) {
    const candidate = idHex.slice(-len);
    if (otherHexIds.every((other) => !other.endsWith(candidate))) {
      return candidate;
    }
  }
  return idHex;
}

function stripDashes(s: string): string {
  return s.replace(/-/g, "");
}

export function idLineComment(kind: SourceFileKind, id: string): string {
  return `<!-- ${ID_FIELD_FOR_KIND[kind]}: ${id} -->`;
}

export function extractIdFromMd(content: string, kind: SourceFileKind): string | null {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  const pattern = new RegExp(`^<!--\\s*${ID_FIELD_FOR_KIND[kind]}\\s*:\\s*([^\\s>]+)\\s*-->\\s*$`);
  const match = firstLine.match(pattern);
  return match === null ? null : match[1];
}

export function stampIdLine(content: string, kind: SourceFileKind, id: string): string {
  const stripped = stripIdLine(content);
  const header = idLineComment(kind, id);
  if (stripped === "") return `${header}\n`;
  return `${header}\n${stripped}`;
}

export function stripIdLine(content: string): string {
  const match = content.match(/^<!--\s*[a-z_]+_id\s*:\s*[^\s>]+\s*-->\s*\r?\n?/);
  if (match === null) return content;
  return content.slice(match[0].length);
}

export function computeContentSha(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function computeFileSha(absPath: string): string {
  return computeContentSha(readFileSync(absPath));
}

export function readSidecar<T>(absPath: string, schema: z.ZodType<T>): T {
  const raw = readFileSync(absPath, "utf-8");
  const parsed = JSON.parse(raw);
  return schema.parse(parsed);
}

export function writeSidecar<S extends z.ZodType>(
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

function hasValidSourceFileExtension(filename: string): boolean {
  return isSourceFileExtension(extname(filename));
}

function isSourceFileExtension(ext: string): ext is SourceFileExtension {
  return (SOURCE_FILE_EXTENSIONS as readonly string[]).includes(ext);
}
