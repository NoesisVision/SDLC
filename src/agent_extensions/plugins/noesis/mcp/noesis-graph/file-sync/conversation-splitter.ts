import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import type {
  Conversation,
  IdeaUnitRef,
} from "../../../shared-contracts/conversation.js";
import {
  computeContentSha,
  computeFileSha,
  conversationJsonPath,
  conversationMdPath,
  decisionJsonPath,
  documentJsonPath,
  ensureNoesisLayout,
  readSidecar,
  stampIdLine,
  topicJsonPath,
  writeSidecar,
} from "../../../shared-contracts/source-files.js";
import {
  ConversationSidecarSchema,
  DecisionFileSchema,
  TopicFileSchema,
  type ConversationSidecar,
  type DecisionFile,
  type TopicFile,
  type TopicFileItem,
} from "../../../shared-contracts/source-file-schemas.js";
import type { AnalyzeConversationOutput } from "../../../shared-contracts/skills/analyze-conversation/output.js";

export interface SplitConversationOptions {
  projectDir: string;
  cleanedMdSourcePath: string;
}

export interface SplitConversationResult {
  md_path: string;
  sidecar_path: string;
  topic_paths: string[];
  decision_paths: string[];
  skipped_paths: string[];
}

export function splitConversation(
  output: AnalyzeConversationOutput,
  options: SplitConversationOptions,
): SplitConversationResult {
  ensureNoesisLayout(options.projectDir);
  const { conversation, potential_topics } = output;
  const skipped: string[] = [];

  const mdPath = relocateCleanedMd(
    options.cleanedMdSourcePath,
    conversationMdPath(options.projectDir, conversation.conversation_id),
    conversation.conversation_id,
  );
  const mdSha = computeFileSha(mdPath);
  const sidecarPath = writeConversationSidecar(
    conversation,
    mdSha,
    options.projectDir,
    skipped,
  );
  const sidecarSha = computeFileSha(sidecarPath);

  const sourceShaResolver = createSourceShaResolver(
    options.projectDir,
    conversation.conversation_id,
    sidecarSha,
  );
  const parentLookup = buildParentLookup(potential_topics.topics);

  const topicPaths: string[] = [];
  const decisionPaths: string[] = [];
  for (const topic of conversation.topics) {
    const parentId = parentLookup.get(topic.id) ?? null;
    const path = writeTopicFile(
      options.projectDir,
      topic,
      parentId,
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

function relocateCleanedMd(
  source: string,
  target: string,
  conversationId: string,
): string {
  if (!existsSync(source)) {
    throw new Error(`Cleaned conversation md not found at ${source}`);
  }
  const sourceContent = readFileSync(source, "utf-8");
  const stamped = stampIdLine(sourceContent, "conversation", conversationId);
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

function writeConversationSidecar(
  conversation: Conversation,
  mdSha: string,
  projectDir: string,
  skipped: string[],
): string {
  const path = conversationJsonPath(projectDir, conversation.conversation_id);
  if (isUserEdited(path, ConversationSidecarSchema)) {
    skipped.push(path);
    return path;
  }
  const next: ConversationSidecar = {
    conversation_id: conversation.conversation_id,
    time: conversation.time,
    main_topic: conversation.main_topic,
    turns: conversation.turns,
    md_sha: mdSha,
    edited_by_user: false,
  };
  writeSidecar(path, next, ConversationSidecarSchema);
  return path;
}

function writeTopicFile(
  projectDir: string,
  topic: Conversation["topics"][number],
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
  decision: Conversation["topics"][number]["decisions"][number],
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

function buildParentLookup(
  potential: AnalyzeConversationOutput["potential_topics"]["topics"],
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const t of potential) {
    map.set(t.id, t.parent_id);
  }
  return map;
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
  currentConversationId: string,
  currentSidecarSha: string,
): SourceShaResolver {
  const cache = new Map<string, string>();
  return (item) => {
    if (item.type === "idea_unit_ref") {
      if (item.conversation_id === currentConversationId) return currentSidecarSha;
      return shaIfExists(
        cache,
        conversationJsonPath(projectDir, item.conversation_id),
      );
    }
    return shaIfExists(cache, documentJsonPath(projectDir, item.document_id));
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
  items: ReadonlyArray<IdeaUnitRef | TopicFileItem>,
  resolver: SourceShaResolver,
): TopicFileItem[] {
  return items.map((item) => ({ ...item, source_sha: resolver(item) }));
}
