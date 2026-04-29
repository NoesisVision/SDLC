import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import {
  computeContentSha,
  computeFileSha,
  conversationJsonPath,
  decisionJsonPath,
  documentJsonPath,
  documentMdPath,
  ensureNoesisLayout,
  readSidecar,
  stampIdLine,
  topicJsonPath,
  writeSidecar,
} from "../../../shared-contracts/source-files.js";
import {
  DecisionFileSchema,
  DocumentSidecarSchema,
  TopicFileSchema,
  type DecisionFile,
  type DocumentSidecar,
  type TopicFile,
  type TopicFileItem,
} from "../../../shared-contracts/source-file-schemas.js";
import type { AnalyzeDesignDraftOutput } from "../../../shared-contracts/skills/analyze-design-draft/output.js";

export interface SplitDocumentOptions {
  projectDir: string;
  sourceMdPath: string;
}

export interface SplitDocumentResult {
  md_path: string;
  sidecar_path: string;
  topic_paths: string[];
  decision_paths: string[];
  skipped_paths: string[];
}

export function splitDocument(
  output: AnalyzeDesignDraftOutput,
  options: SplitDocumentOptions,
): SplitDocumentResult {
  ensureNoesisLayout(options.projectDir);
  const { document } = output;
  const skipped: string[] = [];

  const mdPath = relocateSourceMd(
    options.sourceMdPath,
    documentMdPath(options.projectDir, document.id),
    document.id,
  );
  const mdSha = computeFileSha(mdPath);
  const sidecarPath = writeDocumentSidecar(
    output,
    mdSha,
    options.projectDir,
    skipped,
  );
  const sidecarSha = computeFileSha(sidecarPath);

  const sourceShaResolver = createSourceShaResolver(
    options.projectDir,
    document.id,
    sidecarSha,
  );

  const topicPaths: string[] = [];
  const decisionPaths: string[] = [];
  for (const topic of output.topics) {
    const path = writeTopicFile(
      options.projectDir,
      topic,
      null,
      sourceShaResolver,
      skipped,
    );
    topicPaths.push(path);
    for (const decision of topic.decisions) {
      decisionPaths.push(
        writeDecisionFile(
          options.projectDir,
          topic.id,
          decision,
          sourceShaResolver,
          skipped,
        ),
      );
    }
  }

  return {
    md_path: mdPath,
    sidecar_path: sidecarPath,
    topic_paths: topicPaths,
    decision_paths: decisionPaths,
    skipped_paths: skipped,
  };
}

function relocateSourceMd(
  source: string,
  target: string,
  documentId: string,
): string {
  if (!existsSync(source)) {
    throw new Error(`Source document md not found at ${source}`);
  }
  const sourceContent = readFileSync(source, "utf-8");
  const stamped = stampIdLine(sourceContent, "document", documentId);
  writeFileSync(target, stamped, "utf-8");
  if (source !== target) {
    try {
      unlinkSync(source);
    } catch {
      // best-effort
    }
  }
  return target;
}

function writeDocumentSidecar(
  output: AnalyzeDesignDraftOutput,
  mdSha: string,
  projectDir: string,
  skipped: string[],
): string {
  const path = documentJsonPath(projectDir, output.document.id);
  if (isUserEdited(path, DocumentSidecarSchema)) {
    skipped.push(path);
    return path;
  }
  const next: DocumentSidecar = {
    document_id: output.document.id,
    title: output.document.title,
    date: output.document.date,
    fragments: output.fragments,
    section_tree: output.section_tree,
    md_sha: mdSha,
    edited_by_user: false,
  };
  writeSidecar(path, next, DocumentSidecarSchema);
  return path;
}

function writeTopicFile(
  projectDir: string,
  topic: AnalyzeDesignDraftOutput["topics"][number],
  parentId: string | null,
  resolver: SourceShaResolver,
  skipped: string[],
): string {
  const path = topicJsonPath(projectDir, topic.id);
  const prev = loadIfExists(path, TopicFileSchema);
  if (prev?.edited_by_user === true) {
    skipped.push(path);
    return path;
  }
  const items = withItemShas(topic.items, resolver);
  const next: TopicFile = {
    id: topic.id,
    parent_id: parentId,
    title: topic.title,
    short_summary: topic.short_summary,
    long_summary: topic.long_summary,
    items: prev === null ? items : mergeItems(prev.items, items),
    reviewed: topic.reviewed,
    decisions_extracted: topic.decisions_extracted,
    edited_by_user: false,
  };
  writeSidecar(path, next, TopicFileSchema);
  return path;
}

function writeDecisionFile(
  projectDir: string,
  topicId: string,
  decision: AnalyzeDesignDraftOutput["topics"][number]["decisions"][number],
  resolver: SourceShaResolver,
  skipped: string[],
): string {
  const path = decisionJsonPath(projectDir, decision.id);
  if (isUserEdited(path, DecisionFileSchema)) {
    skipped.push(path);
    return path;
  }
  const next: DecisionFile = {
    id: decision.id,
    topic_id: topicId,
    title: decision.title,
    status: decision.status,
    referenced_items: withItemShas(decision.referenced_items, resolver),
    context: decision.context,
    decision: decision.decision,
    alternative_options: decision.alternative_options,
    edited_by_user: false,
  };
  writeSidecar(path, next, DecisionFileSchema);
  return path;
}

function loadIfExists<T>(
  path: string,
  schema: Parameters<typeof readSidecar<T>>[1],
): T | null {
  if (!existsSync(path)) return null;
  try {
    return readSidecar(path, schema);
  } catch {
    return null;
  }
}

function isUserEdited<T extends { edited_by_user?: boolean }>(
  path: string,
  schema: Parameters<typeof readSidecar<T>>[1],
): boolean {
  const prev = loadIfExists(path, schema);
  return prev?.edited_by_user === true;
}

function mergeItems(prev: TopicFileItem[], next: TopicFileItem[]): TopicFileItem[] {
  const seen = new Set<string>();
  const out: TopicFileItem[] = [];
  for (const list of [prev, next]) {
    for (const item of list) {
      const key = itemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function itemKey(item: TopicFileItem): string {
  if (item.type === "idea_unit_ref") {
    return `iu:${item.conversation_id}:${item.turn_index}:${item.idea_unit_index}`;
  }
  return `doc:${item.document_id}:${item.start_offset}:${item.end_offset}`;
}

type SourceShaResolver = (item: TopicFileItem) => string | undefined;

function createSourceShaResolver(
  projectDir: string,
  currentDocumentId: string,
  currentSidecarSha: string,
): SourceShaResolver {
  const cache = new Map<string, string>();
  return (item) => {
    if (item.type === "document_fragment_ref") {
      if (item.document_id === currentDocumentId) return currentSidecarSha;
      return shaIfExists(
        cache,
        documentJsonPath(projectDir, item.document_id),
      );
    }
    return shaIfExists(
      cache,
      conversationJsonPath(projectDir, item.conversation_id),
    );
  };
}

function shaIfExists(cache: Map<string, string>, path: string): string | undefined {
  if (cache.has(path)) return cache.get(path);
  if (!existsSync(path)) return undefined;
  const sha = computeContentSha(readFileSync(path));
  cache.set(path, sha);
  return sha;
}

function withItemShas(
  items: ReadonlyArray<TopicFileItem>,
  resolver: SourceShaResolver,
): TopicFileItem[] {
  return items.map((item) => ({ ...item, source_sha: resolver(item) }));
}
