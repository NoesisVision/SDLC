import { Inject, Injectable } from "@nestjs/common";
import { existsSync, readFileSync } from "fs";
import {
  buildTurnMap,
  formatEnrichedTopicMarkdown,
  isIrrelevant,
  resolveIdeaUnitDetail,
  type EnrichedSubtopic,
  type EnrichedTopic,
  type IdeaUnitDetail,
  type IdeaUnitRef,
} from "../../../../shared-contracts/conversation.js";
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
} from "../../../../shared-contracts/source-file-schemas.js";
import {
  computeContentSha,
  computeFileSha,
  findConversationJsonById,
  findDocumentJsonById,
} from "../../../../shared-contracts/source-files.js";
import type {
  ConversationDecisionRef,
  ConversationDetailData,
  ConversationListItem,
  ConversationsPageData,
  ConversationTopicRef,
} from "../../ui-contracts/conversations/conversations-data.js";
import { PROJECT_DIR } from "../../config/config.module.js";
import { DecisionsRepository } from "../decisions/decisions.repository.js";
import {
  confirmedKey,
  detectDecisionConflicts,
  detectTopicConflicts,
  LockedFieldsBlockedError,
  resolveDecisionLockedFields,
  resolveTopicLockedFields,
  type ConfirmedEdit,
} from "../locks.js";
import { TopicsRepository } from "../topics/topics.repository.js";
import { ConversationsRepository } from "./conversations.repository.js";
import {
  validateAnalyzeConversationOutput,
  type GraphLookup,
  type ValidationResult,
} from "./validate-output.js";

export {
  LockedFieldsBlockedError,
  type ConfirmedEdit,
  type DecisionLockedField,
  type TopicLockedField,
} from "../locks.js";

export interface ConversationAnalysisOutput {
  outputJsonPath: string;
  confirmed_edits?: ConfirmedEdit[];
}

export interface UploadConversationAnalysisResult {
  conversation_id: string;
  topic_paths: string[];
  decision_paths: string[];
  cleared_locks: ConfirmedEdit[];
}

export interface IndexFileOutcome {
  status: "indexed" | "unchanged";
  conversation_id: string;
}

export interface ReviewBundle {
  topic_count: number;
  topics_with_prior_units: number;
  markdown: string;
}

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(PROJECT_DIR) private readonly projectDir: string,
    private readonly repository: ConversationsRepository,
    private readonly topicsRepository: TopicsRepository,
    private readonly decisionsRepository: DecisionsRepository,
  ) {}

  async deleteForFile(
    absPath: string,
  ): Promise<{ conversation_id: string } | null> {
    const stored = await this.findStoredForFile(absPath);
    if (stored === null) return null;
    await this.repository.delete(stored.id);
    const json = this.repository.findJsonById(this.projectDir, stored.id);
    if (json !== null) this.repository.deleteFile(json);
    return { conversation_id: stored.id };
  }

  private async findStoredForFile(
    absPath: string,
  ): Promise<{ id: string; main_topic: string } | null> {
    const all = await this.repository.listAll();
    for (const c of all) {
      const json = this.repository.canonicalJsonPath(
        this.projectDir,
        c.id,
        c.main_topic,
      );
      if (json === absPath) return c;
    }
    return null;
  }

  async getConversationDetail(
    conversationId: string,
  ): Promise<ConversationDetailData> {
    const head = await this.repository.read(conversationId);
    if (head === null) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    const [topics, decisions] = await Promise.all([
      this.collectLinkedTopics(conversationId),
      this.collectLinkedDecisions(conversationId),
    ]);
    return {
      id: head.id,
      title: head.main_topic,
      date: head.time,
      topics,
      decisions,
    };
  }

  async getConversationsPage(): Promise<ConversationsPageData> {
    const all = await this.repository.listAll();
    const conversations: ConversationListItem[] = all.map((c) => ({
      id: c.id,
      title: c.main_topic,
      date: c.time,
    }));
    return { conversations };
  }

  async hasConversation(conversationId: string): Promise<boolean> {
    return this.repository.exists(conversationId);
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

  async prepareReviewBundle(outputPath: string): Promise<ReviewBundle> {
    const output = this.loadOutput(outputPath);
    const conv = output.conversation;
    const order = postOrderTopicIds(conv.topics, output.potential_topics.topics);
    const byId = new Map(conv.topics.map((t) => [t.id, t] as const));
    const currentTurnMap = buildTurnMap(conv.turns);

    const sections: string[] = [];
    let topicsWithPrior = 0;

    for (const id of order) {
      const topic = byId.get(id);
      if (topic === undefined) continue;

      const priorDetails = await this.findPriorIdeaUnits(
        topic.id,
        conv.conversation_id,
      );
      if (priorDetails.length > 0) topicsWithPrior++;

      const details: IdeaUnitDetail[] = [];
      const seen = new Set<string>();
      for (const item of topic.items) {
        if (item.type !== "idea_unit_ref") continue;
        const key = priorIdeaUnitKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        const detail = resolveIdeaUnitDetail(item, currentTurnMap);
        if (detail === null || isIrrelevant(detail.categories)) continue;
        details.push(detail);
      }
      for (const prior of priorDetails) {
        const key = `${prior.conversation_id}:${prior.turn_index}:${prior.idea_unit_index}`;
        if (seen.has(key)) continue;
        seen.add(key);
        details.push(prior);
      }

      const subtopics = collectSubtopics(
        topic.id,
        conv.topics,
        output.potential_topics.topics,
      );

      const enriched: EnrichedTopic = {
        id: topic.id,
        title: topic.title,
        short_summary: topic.short_summary,
        long_summary: topic.long_summary,
        conversation_id: conv.conversation_id,
        idea_units: details,
        subtopics,
      };

      const hasDecisionUnits = details.some((d) =>
        d.categories.includes("Decision"),
      );

      const header = [
        `<!-- topic_id: ${topic.id} -->`,
        `<!-- num_items: ${details.length} -->`,
        `<!-- has_decision_units: ${hasDecisionUnits} -->`,
        "",
      ].join("\n");

      sections.push(header + formatEnrichedTopicMarkdown(enriched));
    }

    const markdown = ["# Topics for review", "", ...joinSections(sections)].join(
      "\n",
    );

    return {
      topic_count: order.length,
      topics_with_prior_units: topicsWithPrior,
      markdown,
    };
  }

  async validateOutput(workingDir: string): Promise<ValidationResult> {
    const path = `${workingDir.replace(/\/$/, "")}/output.json`;
    if (!existsSync(path)) {
      throw new Error(`analyze-conversation output not found at ${path}`);
    }
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    return validateAnalyzeConversationOutput(raw, this.graphLookup());
  }

  async uploadAnalysis(input: ConversationAnalysisOutput): Promise<UploadConversationAnalysisResult> {
    const output = this.loadOutput(input.outputJsonPath);
    this.validate(output);
    const conflicts = this.detectLockedFieldConflicts(output);
    if (input.confirmed_edits === undefined && conflicts.length > 0) {
      throw new LockedFieldsBlockedError(conflicts);
    }
    const confirmedSet = new Set((input.confirmed_edits ?? []).map(confirmedKey));
    return this.split(output, confirmedSet);
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

  private detectLockedFieldConflicts(
    output: AnalyzeConversationOutput,
  ): ConfirmedEdit[] {
    const conflicts: ConfirmedEdit[] = [];
    for (const topic of output.conversation.topics) {
      const topicPath = this.topicsRepository.findFileById(
        this.projectDir,
        topic.id,
      );
      const existingTopic =
        topicPath === null ? null : readTopicIfExists(topicPath);
      conflicts.push(...detectTopicConflicts(existingTopic, topic));
      for (const decision of topic.decisions) {
        const dpath = this.decisionsRepository.findFileById(
          this.projectDir,
          decision.id,
        );
        const existingDecision =
          dpath !== null && this.decisionsRepository.fileExists(dpath)
            ? this.decisionsRepository.readFile(dpath)
            : null;
        conflicts.push(...detectDecisionConflicts(existingDecision, decision));
      }
    }
    return conflicts;
  }

  private split(
    output: AnalyzeConversationOutput,
    confirmed: Set<string>,
  ): UploadConversationAnalysisResult {
    const conv = output.conversation;

    const conversationFile: ConversationFileNew = {
      conversation_id: conv.conversation_id,
      time: conv.time,
      main_topic: conv.main_topic,
      turns: conv.turns,
    };
    const jsonPath = this.persistJson(conversationFile);

    const conversationSha = computeFileSha(jsonPath);
    const parentLookup = new Map<string, string | null>();
    for (const pt of output.potential_topics.topics) {
      parentLookup.set(pt.id, pt.parent_id);
    }

    const sourceShaCache = new Map<string, string>();
    sourceShaCache.set(`conversation:${conv.conversation_id}`, conversationSha);

    const topicPaths: string[] = [];
    const decisionPaths: string[] = [];
    const clearedLocks: ConfirmedEdit[] = [];

    for (const topic of conv.topics) {
      const { path, cleared } = this.writeTopicFile(
        topic,
        parentLookup.get(topic.id) ?? null,
        sourceShaCache,
        confirmed,
      );
      topicPaths.push(path);
      clearedLocks.push(...cleared);
      for (const decision of topic.decisions) {
        const dr = this.writeDecisionFile(
          topic.id,
          decision,
          sourceShaCache,
          confirmed,
        );
        decisionPaths.push(dr.path);
        clearedLocks.push(...dr.cleared);
      }
    }

    return {
      conversation_id: conv.conversation_id,
      topic_paths: topicPaths,
      decision_paths: decisionPaths,
      cleared_locks: clearedLocks,
    };
  }

  private writeTopicFile(
    topic: AnalyzeConversationOutput["conversation"]["topics"][number],
    parentId: string | null,
    cache: Map<string, string>,
    confirmed: Set<string>,
  ): { path: string; cleared: ConfirmedEdit[] } {
    const items = withItemShas(topic.items as TopicItemRefNew[], this.projectDir, cache);
    const existingPath = this.topicsRepository.findFileById(
      this.projectDir,
      topic.id,
    );
    const existing =
      existingPath === null ? null : readTopicIfExists(existingPath);
    const cleared: ConfirmedEdit[] = [];
    const resolved = resolveTopicLockedFields(existing, topic, confirmed, cleared);
    const next: TopicFileNew = {
      id: topic.id,
      parent_id: parentId,
      title: resolved.title,
      title_locked: resolved.title_locked,
      short_summary: resolved.short_summary,
      short_summary_locked: resolved.short_summary_locked,
      long_summary: resolved.long_summary,
      long_summary_locked: resolved.long_summary_locked,
      items: existing === null ? items : mergeItems(existing.items, items),
      reviewed: topic.reviewed,
      decisions_extracted: topic.decisions_extracted,
      is_stale: existing?.is_stale ?? false,
    };
    const newPath = this.topicsRepository.canonicalPath(
      this.projectDir,
      next.id,
      next.title,
    );
    if (existingPath !== null && existingPath !== newPath) {
      this.topicsRepository.deleteFile(existingPath);
    }
    this.topicsRepository.writeFile(newPath, next);
    return { path: newPath, cleared };
  }

  private writeDecisionFile(
    topicId: string,
    decision: AnalyzeConversationOutput["conversation"]["topics"][number]["decisions"][number],
    cache: Map<string, string>,
    confirmed: Set<string>,
  ): { path: string; cleared: ConfirmedEdit[] } {
    const existingPath = this.decisionsRepository.findFileById(
      this.projectDir,
      decision.id,
    );
    const referenced = withItemShas(
      decision.referenced_items as TopicItemRefNew[],
      this.projectDir,
      cache,
    );
    const existing =
      existingPath !== null && this.decisionsRepository.fileExists(existingPath)
        ? this.decisionsRepository.readFile(existingPath)
        : null;
    const cleared: ConfirmedEdit[] = [];
    const resolved = resolveDecisionLockedFields(existing, decision, confirmed, cleared);
    const next: DecisionFileNew = {
      id: decision.id,
      topic_id: topicId,
      title: resolved.title,
      title_locked: resolved.title_locked,
      status: resolved.status,
      status_locked: resolved.status_locked,
      referenced_items: referenced,
      context: {
        text: resolved.context_text,
        text_locked: resolved.context_text_locked,
        supporting_item_indices: decision.context.supporting_item_indices,
      },
      decision: {
        text: resolved.decision_text,
        text_locked: resolved.decision_text_locked,
        rationale: resolved.decision_rationale,
        rationale_locked: resolved.decision_rationale_locked,
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
    const newPath = this.decisionsRepository.canonicalPath(
      this.projectDir,
      next.id,
      next.title,
    );
    if (existingPath !== null && existingPath !== newPath) {
      this.decisionsRepository.deleteFile(existingPath);
    }
    this.decisionsRepository.writeFile(newPath, next);
    return { path: newPath, cleared };
  }

  private persistJson(file: ConversationFileNew): string {
    const newPath = this.repository.canonicalJsonPath(
      this.projectDir,
      file.conversation_id,
      file.main_topic,
    );
    const previous = this.repository.findJsonById(
      this.projectDir,
      file.conversation_id,
    );
    if (previous !== null && previous !== newPath) {
      this.repository.deleteFile(previous);
    }
    this.repository.writeJsonFile(newPath, file);
    return newPath;
  }

  private async collectLinkedDecisions(
    conversationId: string,
  ): Promise<ConversationDecisionRef[]> {
    const stored = await this.decisionsRepository.listAll();
    const out: ConversationDecisionRef[] = [];
    for (const decision of stored) {
      const path = this.decisionsRepository.findFileById(
        this.projectDir,
        decision.id,
      );
      if (path === null) continue;
      const file = this.decisionsRepository.readFile(path);
      if (!fileReferencesConversation(file.referenced_items, conversationId)) {
        continue;
      }
      out.push({
        decision_id: decision.id,
        title: decision.title,
        status: decision.status,
      });
    }
    out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  }

  private async collectLinkedTopics(
    conversationId: string,
  ): Promise<ConversationTopicRef[]> {
    const stored = await this.topicsRepository.listAll();
    const out: ConversationTopicRef[] = [];
    for (const topic of stored) {
      const path = this.topicsRepository.findFileById(this.projectDir, topic.id);
      if (path === null) continue;
      const file = this.topicsRepository.readFile(path);
      if (!fileReferencesConversation(file.items, conversationId)) continue;
      out.push({ topic_id: topic.id, title: topic.title });
    }
    out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  }

  private async findPriorIdeaUnits(
    topicId: string,
    excludeConversationId: string,
  ): Promise<IdeaUnitDetail[]> {
    const path = this.topicsRepository.findFileById(this.projectDir, topicId);
    if (path === null) return [];
    const file = this.topicsRepository.readFile(path);
    const positionsByConv = new Map<
      string,
      Array<{ turn_index: number; idea_unit_index: number }>
    >();
    for (const item of file.items) {
      if (item.type !== "idea_unit_ref") continue;
      if (item.conversation_id === excludeConversationId) continue;
      const list = positionsByConv.get(item.conversation_id) ?? [];
      list.push({
        turn_index: item.turn_index,
        idea_unit_index: item.idea_unit_index,
      });
      positionsByConv.set(item.conversation_id, list);
    }
    const out: IdeaUnitDetail[] = [];
    for (const [convId, positions] of positionsByConv) {
      const details = await this.repository.listIdeaUnitDetails(convId, positions);
      for (const d of details) {
        if (isIrrelevant(d.categories as IdeaUnitDetail["categories"])) continue;
        out.push({
          conversation_id: d.conversation_id,
          turn_index: d.turn_index,
          idea_unit_index: d.idea_unit_index,
          speaker: d.speaker,
          time: d.time,
          sentences: d.sentences,
          categories: d.categories as IdeaUnitDetail["categories"],
        });
      }
    }
    out.sort((a, b) => {
      if (a.conversation_id !== b.conversation_id)
        return a.conversation_id.localeCompare(b.conversation_id);
      if (a.turn_index !== b.turn_index) return a.turn_index - b.turn_index;
      return a.idea_unit_index - b.idea_unit_index;
    });
    return out;
  }

  private graphLookup(): GraphLookup {
    return { topicExists: (id) => this.topicsRepository.exists(id) };
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
      ? findConversationJsonById(projectDir, item.conversation_id)
      : findDocumentJsonById(projectDir, item.document_id);
  if (path === null || !existsSync(path)) return undefined;
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

function fileReferencesConversation(
  items: TopicItemRefNew[],
  conversationId: string,
): boolean {
  for (const item of items) {
    if (item.type === "idea_unit_ref" && item.conversation_id === conversationId) {
      return true;
    }
  }
  return false;
}

function priorIdeaUnitKey(item: IdeaUnitRef): string {
  return `${item.conversation_id}:${item.turn_index}:${item.idea_unit_index}`;
}

function buildParentLookup(
  potentialTopics: AnalyzeConversationOutput["potential_topics"]["topics"],
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const t of potentialTopics) map.set(t.id, t.parent_id);
  return map;
}

function collectSubtopics(
  parentId: string,
  topics: AnalyzeConversationOutput["conversation"]["topics"],
  potentialTopics: AnalyzeConversationOutput["potential_topics"]["topics"],
): EnrichedSubtopic[] {
  const parents = buildParentLookup(potentialTopics);
  const subtopics: EnrichedSubtopic[] = [];
  for (const t of topics) {
    if ((parents.get(t.id) ?? null) !== parentId) continue;
    subtopics.push({
      id: t.id,
      title: t.title,
      short_summary: t.short_summary,
      reviewed: t.reviewed,
    });
  }
  return subtopics;
}

function joinSections(sections: string[]): string[] {
  if (sections.length === 0) return [];
  const out: string[] = [];
  for (let i = 0; i < sections.length; i++) {
    if (i > 0) out.push("---", "");
    out.push(sections[i]);
  }
  return out;
}

function postOrderTopicIds(
  topics: AnalyzeConversationOutput["conversation"]["topics"],
  potentialTopics: AnalyzeConversationOutput["potential_topics"]["topics"],
): string[] {
  const idSet = new Set(topics.map((t) => t.id));
  const parents = buildParentLookup(potentialTopics);
  const childrenByParent = new Map<string, string[]>();
  const roots: string[] = [];
  for (const t of topics) {
    const declaredParent = parents.get(t.id) ?? null;
    const effectiveParent =
      declaredParent !== null && idSet.has(declaredParent) ? declaredParent : null;
    if (effectiveParent === null) {
      roots.push(t.id);
      continue;
    }
    const siblings = childrenByParent.get(effectiveParent) ?? [];
    siblings.push(t.id);
    childrenByParent.set(effectiveParent, siblings);
  }
  const out: string[] = [];
  const visited = new Set<string>();
  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    for (const child of childrenByParent.get(id) ?? []) visit(child);
    out.push(id);
  }
  for (const root of roots) visit(root);
  for (const t of topics) visit(t.id);
  return out;
}
