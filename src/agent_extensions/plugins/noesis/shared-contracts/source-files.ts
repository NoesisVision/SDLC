import { createHash } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
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

const SUBDIR_FOR_KIND: Record<SourceFileKind, string> = {
  conversation: "conversations",
  document: "documents",
  topic: "topics",
  decision: "decisions",
  design_doc: "design-docs",
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

export function noesisSubdirPath(
  projectDir: string,
  kind: SourceFileKind,
): string {
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

export function designDocJsonPath(projectDir: string, id: string): string {
  return resolve(noesisSubdirPath(projectDir, "design_doc"), `${id}.json`);
}

export function idLineComment(kind: SourceFileKind, id: string): string {
  return `<!-- ${ID_FIELD_FOR_KIND[kind]}: ${id} -->`;
}

export function extractIdFromMd(
  content: string,
  kind: SourceFileKind,
): string | null {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  const pattern = new RegExp(
    `^<!--\\s*${ID_FIELD_FOR_KIND[kind]}\\s*:\\s*([^\\s>]+)\\s*-->\\s*$`,
  );
  const match = firstLine.match(pattern);
  return match === null ? null : match[1];
}

export function stampIdLine(
  content: string,
  kind: SourceFileKind,
  id: string,
): string {
  const stripped = stripIdLine(content);
  const header = idLineComment(kind, id);
  if (stripped === "") return `${header}\n`;
  return `${header}\n${stripped}`;
}

export function stripIdLine(content: string): string {
  const match = content.match(
    /^<!--\s*[a-z_]+_id\s*:\s*[^\s>]+\s*-->\s*\r?\n?/,
  );
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

export function writeSidecar<T>(
  absPath: string,
  data: T,
  schema: z.ZodType<T>,
): void {
  const validated = schema.parse(data);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, `${JSON.stringify(validated, null, 2)}\n`, "utf-8");
}

export function ensureNoesisLayout(projectDir: string): void {
  for (const kind of Object.keys(SUBDIR_FOR_KIND) as SourceFileKind[]) {
    mkdirSync(noesisSubdirPath(projectDir, kind), { recursive: true });
  }
}

export function isUnderNoesisRoot(projectDir: string, absPath: string): boolean {
  const root = noesisRoot(projectDir);
  const target = resolve(absPath);
  return target === root || target.startsWith(`${root}/`);
}
