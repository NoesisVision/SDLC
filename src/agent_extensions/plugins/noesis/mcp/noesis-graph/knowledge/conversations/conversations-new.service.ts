import { Inject, Injectable } from "@nestjs/common";
import { existsSync, readFileSync } from "fs";
import {
  AnalyzeConversationOutputSchema,
  type AnalyzeConversationOutput,
} from "../../../../shared-contracts/skills/analyze-conversation/output.js";
import {
  TopicFileNewSchema,
  type ConversationFileNew,
  type DecisionFileNew,
  type TopicFileNew,
  type TopicItemRefNew,
} from "../../../../shared-contracts/source-file-schemas-new.js";
import {
  computeContentSha,
  computeFileSha,
  conversationJsonPath,
  decisionJsonPath,
  documentJsonPath,
  ensureNoesisLayout,
  stampIdLine,
  topicJsonPath,
} from "../../../../shared-contracts/source-files.js";
import { PROJECT_DIR } from "../../config/config.module.js";
import { DecisionsRepositoryNew } from "../decisions/decisions-new.repository.js";
import { TopicsRepositoryNew } from "../topics/topics-new.repository.js";
import { ConversationsRepositoryNew } from "./conversations-new.repository.js";

export interface MergeConversationInput {
  outputJsonPath: string;
  cleanedMdPath: string;
}

export interface MergeConversationResult {
  conversation_id: string;
  topic_paths: string[];
  decision_paths: string[];
}

export interface IndexFileOutcome {
  status: "indexed" | "unchanged";
  conversation_id: string;
}

@Injectable()
export class ConversationsServiceNew {
  constructor(
    @Inject(PROJECT_DIR) private readonly projectDir: string,
    private readonly repository: ConversationsRepositoryNew,
    private readonly topicsRepository: TopicsRepositoryNew,
    private readonly decisionsRepository: DecisionsRepositoryNew,
  ) {}

  async deleteForFile(
    absPath: string,
  ): Promise<{ conversation_id: string } | null> {
    const id = inferConversationIdFromPath(absPath);
    if (id === null) return null;
    if (!(await this.repository.exists(id))) return null;
    await this.repository.delete(id);
    return { conversation_id: id };
  }

  async indexFile(absPath: string): Promise<IndexFileOutcome> {
    const sha = this.repository.fileSha(absPath);
    const file = this.repository.readJsonFile(absPath);
    const stored = await this.repository.read(file.conversation_id);
    if (stored !== null && stored.sha === sha) {
      return { status: "unchanged", conversation_id: file.conversation_id };
    }
    await this.repository.upsert(file, sha);
    return { status: "indexed", conversation_id: file.conversation_id };
  }

  async listAllStoredFiles(): Promise<
    Array<{ id: string; path: string; sha: string }>
  > {
    return this.repository.listAllStoredFiles(this.projectDir);
  }

  async merge(input: MergeConversationInput): Promise<MergeConversationResult> {
    const output = this.loadOutput(input.outputJsonPath);
    this.validate(output);
    const cleanedMd = this.loadCleanedMd(input.cleanedMdPath);
    return this.split(output, cleanedMd);
  }

  // ----- private: merge pipeline -----

  private loadOutput(path: string): AnalyzeConversationOutput {
    if (!existsSync(path)) {
      throw new Error(`analyze-conversation output not found at ${path}`);
    }
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    return AnalyzeConversationOutputSchema.parse(parsed);
  }

  private loadCleanedMd(path: string): string {
    if (!existsSync(path)) {
      throw new Error(`Cleaned conversation md not found at ${path}`);
    }
    return readFileSync(path, "utf-8");
  }

  private validate(output: AnalyzeConversationOutput): void {
    const conv = output.conversation;
    const refMap = new Map<string, true>();
    for (const turn of conv.turns) {
      for (const iu of turn.idea_units) {
        refMap.set(`${turn.index}|${iu.index}`, true);
      }
    }
    for (const topic of conv.topics) {
      if (!topic.reviewed) {
        throw new Error(
          `Topic ${topic.id} is not marked reviewed; analyze-conversation must complete the review pass.`,
        );
      }
      for (const item of topic.items) {
        if (item.type !== "idea_unit_ref") continue;
        if (item.conversation_id !== conv.conversation_id) continue;
        const key = `${item.turn_index}|${item.idea_unit_index}`;
        if (!refMap.has(key)) {
          throw new Error(
            `Topic ${topic.id} references unknown idea unit ${key} in current conversation.`,
          );
        }
      }
    }
    const topicIds = new Set(conv.topics.map((t) => t.id));
    for (const pt of output.potential_topics.topics) {
      if (pt.parent_id !== null && pt.is_new && !topicIds.has(pt.id)) {
        throw new Error(
          `potential_topics references new topic ${pt.id} not present in conversation.topics`,
        );
      }
    }
  }

  private split(
    output: AnalyzeConversationOutput,
    cleanedMd: string,
  ): MergeConversationResult {
    ensureNoesisLayout(this.projectDir);
    const conv = output.conversation;
    const stampedMd = stampIdLine(cleanedMd, "conversation", conv.conversation_id);
    const mdPath = this.canonicalMdPath(conv.conversation_id);
    this.repository.writeCleanedMd(mdPath, stampedMd);

    const conversationFile: ConversationFileNew = {
      conversation_id: conv.conversation_id,
      time: conv.time,
      main_topic: conv.main_topic,
      turns: conv.turns,
    };
    const jsonPath = this.canonicalJsonPath(conv.conversation_id);
    this.repository.writeJsonFile(jsonPath, conversationFile);

    const conversationSha = computeFileSha(jsonPath);
    const parentLookup = new Map<string, string | null>();
    for (const pt of output.potential_topics.topics) {
      parentLookup.set(pt.id, pt.parent_id);
    }

    const sourceShaCache = new Map<string, string>();
    sourceShaCache.set(`conversation:${conv.conversation_id}`, conversationSha);

    const topicPaths: string[] = [];
    const decisionPaths: string[] = [];

    for (const topic of conv.topics) {
      const path = this.writeTopicFile(
        topic,
        parentLookup.get(topic.id) ?? null,
        sourceShaCache,
      );
      topicPaths.push(path);
      for (const decision of topic.decisions) {
        decisionPaths.push(this.writeDecisionFile(topic.id, decision, sourceShaCache));
      }
    }

    return {
      conversation_id: conv.conversation_id,
      topic_paths: topicPaths,
      decision_paths: decisionPaths,
    };
  }

  private writeTopicFile(
    topic: AnalyzeConversationOutput["conversation"]["topics"][number],
    parentId: string | null,
    cache: Map<string, string>,
  ): string {
    const path = topicJsonPath(this.projectDir, topic.id);
    const items = withItemShas(topic.items as TopicItemRefNew[], this.projectDir, cache);
    const existing = readTopicIfExists(path);
    const next: TopicFileNew = {
      id: topic.id,
      parent_id: parentId,
      title: topic.title,
      title_locked: existing?.title_locked ?? false,
      short_summary: topic.short_summary,
      short_summary_locked: existing?.short_summary_locked ?? false,
      long_summary: topic.long_summary,
      long_summary_locked: existing?.long_summary_locked ?? false,
      items: existing === null ? items : mergeItems(existing.items, items),
      reviewed: topic.reviewed,
      decisions_extracted: topic.decisions_extracted,
      is_stale: existing?.is_stale ?? false,
    };
    this.topicsRepository.writeFile(path, mergeLockedFields(existing, next));
    return path;
  }

  private writeDecisionFile(
    topicId: string,
    decision: AnalyzeConversationOutput["conversation"]["topics"][number]["decisions"][number],
    cache: Map<string, string>,
  ): string {
    const path = decisionJsonPath(this.projectDir, decision.id);
    const referenced = withItemShas(
      decision.referenced_items as TopicItemRefNew[],
      this.projectDir,
      cache,
    );
    const existing = this.decisionsRepository.fileExists(path)
      ? this.decisionsRepository.readFile(path)
      : null;
    const next: DecisionFileNew = {
      id: decision.id,
      topic_id: topicId,
      title: decision.title,
      title_locked: existing?.title_locked ?? false,
      status: decision.status,
      status_locked: existing?.status_locked ?? false,
      referenced_items: referenced,
      context: {
        text: decision.context.text,
        text_locked: existing?.context.text_locked ?? false,
        supporting_item_indices: decision.context.supporting_item_indices,
      },
      decision: {
        text: decision.decision.text,
        text_locked: existing?.decision.text_locked ?? false,
        rationale: decision.decision.rationale,
        rationale_locked: existing?.decision.rationale_locked ?? false,
        supporting_item_indices: decision.decision.supporting_item_indices,
      },
      alternative_options: decision.alternative_options.map((alt, i) => ({
        text: alt.text,
        text_locked: existing?.alternative_options[i]?.text_locked ?? false,
        rationale: alt.rationale,
        rationale_locked: existing?.alternative_options[i]?.rationale_locked ?? false,
        supporting_item_indices: alt.supporting_item_indices,
      })),
      is_stale: existing?.is_stale ?? false,
    };
    this.decisionsRepository.writeFile(path, applyDecisionLocks(existing, next));
    return path;
  }

  private canonicalJsonPath(conversationId: string): string {
    return this.repository.canonicalJsonPath(this.projectDir, conversationId);
  }

  private canonicalMdPath(conversationId: string): string {
    return this.repository.canonicalMdPath(this.projectDir, conversationId);
  }
}

function withItemShas(
  items: ReadonlyArray<TopicItemRefNew>,
  projectDir: string,
  cache: Map<string, string>,
): TopicItemRefNew[] {
  return items.map((item) => {
    const sha = resolveSourceSha(item, projectDir, cache);
    return { ...item, source_sha: sha ?? item.source_sha };
  });
}

function resolveSourceSha(
  item: TopicItemRefNew,
  projectDir: string,
  cache: Map<string, string>,
): string | undefined {
  const key =
    item.type === "idea_unit_ref"
      ? `conversation:${item.conversation_id}`
      : `document:${item.document_id}`;
  if (cache.has(key)) return cache.get(key);
  const path =
    item.type === "idea_unit_ref"
      ? conversationJsonPath(projectDir, item.conversation_id)
      : documentJsonPath(projectDir, item.document_id);
  if (!existsSync(path)) return undefined;
  const sha = computeContentSha(readFileSync(path));
  cache.set(key, sha);
  return sha;
}

function mergeItems(prev: TopicItemRefNew[], next: TopicItemRefNew[]): TopicItemRefNew[] {
  const seen = new Set<string>();
  const out: TopicItemRefNew[] = [];
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

function itemKey(item: TopicItemRefNew): string {
  if (item.type === "idea_unit_ref") {
    return `iu:${item.conversation_id}:${item.turn_index}:${item.idea_unit_index}`;
  }
  return `doc:${item.document_id}:${item.start_offset}:${item.end_offset}`;
}

function readTopicIfExists(absPath: string): TopicFileNew | null {
  if (!existsSync(absPath)) return null;
  try {
    return TopicFileNewSchema.parse(JSON.parse(readFileSync(absPath, "utf-8")));
  } catch {
    return null;
  }
}

function mergeLockedFields(
  existing: TopicFileNew | null,
  next: TopicFileNew,
): TopicFileNew {
  if (existing === null) return next;
  return {
    ...next,
    title: existing.title_locked ? existing.title : next.title,
    short_summary: existing.short_summary_locked
      ? existing.short_summary
      : next.short_summary,
    long_summary: existing.long_summary_locked
      ? existing.long_summary
      : next.long_summary,
  };
}

function applyDecisionLocks(
  existing: DecisionFileNew | null,
  next: DecisionFileNew,
): DecisionFileNew {
  if (existing === null) return next;
  return {
    ...next,
    title: existing.title_locked ? existing.title : next.title,
    status: existing.status_locked ? existing.status : next.status,
    context: {
      ...next.context,
      text: existing.context.text_locked
        ? existing.context.text
        : next.context.text,
    },
    decision: {
      ...next.decision,
      text: existing.decision.text_locked
        ? existing.decision.text
        : next.decision.text,
      rationale: existing.decision.rationale_locked
        ? existing.decision.rationale
        : next.decision.rationale,
    },
    alternative_options: next.alternative_options.map((alt, i) => {
      const prev = existing.alternative_options[i];
      if (prev === undefined) return alt;
      return {
        ...alt,
        text: prev.text_locked ? prev.text : alt.text,
        rationale: prev.rationale_locked ? prev.rationale : alt.rationale,
      };
    }),
  };
}

function inferConversationIdFromPath(absPath: string): string | null {
  const match = /\/conversations\/([^/]+)\.json$/.exec(absPath);
  return match === null ? null : match[1];
}
