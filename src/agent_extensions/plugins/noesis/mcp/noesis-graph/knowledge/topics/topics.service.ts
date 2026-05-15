import { Inject, Injectable } from "@nestjs/common";
import type { TopicFileNew } from "../../../../shared-contracts/source-file-schemas.js";
import type { SourceContentRef } from "../../../../shared-contracts/source-content.js";
import { newUuid } from "../../../../shared-contracts/uuid.js";
import type {
  TopicConversationDetail,
  TopicConversationRef,
  TopicDocumentDetail,
  TopicDocumentRef,
  TopicNode,
  TopicsPageData,
} from "../../ui-contracts/topics/topics-data.js";
import { PROJECT_DIR } from "../../config/config.module.js";
import { ConversationsRepository } from "../conversations/conversations.repository.js";
import { DocumentsRepository } from "../documents/documents.repository.js";
import {
  TopicsRepository,
  type StoredTopic,
} from "./topics.repository.js";

export type LockedField = "title" | "short_summary" | "long_summary";

export interface TopicEditableFields {
  title?: string;
  short_summary?: string;
  long_summary?: string;
}

export interface IndexFileOutcome {
  status: "indexed" | "unchanged";
  topic_id: string;
}

export interface SourceShaSnapshot {
  conversation: Map<string, string>;
  document: Map<string, string>;
}

export interface TopicOverview {
  id: string;
  title: string;
  short_summary: string;
  long_summary: string;
  has_subtopics: boolean;
  path: string[];
}

export interface TopicDetail {
  id: string;
  title: string;
  short_summary: string;
  long_summary: string;
  path: string[];
}

export interface TopicSummaryWithPath {
  id: string;
  title: string;
  short_summary: string;
  long_summary: string;
  path: string[];
}

export interface TopicIdeaUnitItem {
  type: "idea_unit";
  conversation_id: string;
  conversation_main_topic: string;
  conversation_time: string;
  turn_index: number;
  idea_unit_index: number;
  speaker: string;
  time: string;
  sentences: string[];
  categories: string[];
}

export interface TopicDocumentFragmentItem {
  type: "document_fragment";
  document_id: string;
  document_title: string;
  document_date: string;
  start_offset: number;
  end_offset: number;
  text: string;
}

export type TopicItemEntry = TopicIdeaUnitItem | TopicDocumentFragmentItem;

@Injectable()
export class TopicsService {
  constructor(
    @Inject(PROJECT_DIR) private readonly projectDir: string,
    private readonly repository: TopicsRepository,
    private readonly conversationsRepository: ConversationsRepository,
    private readonly documentsRepository: DocumentsRepository,
  ) {}

  canonicalPath(topicId: string, title: string): string {
    return this.repository.canonicalPath(this.projectDir, topicId, title);
  }

  async deleteForFile(absPath: string): Promise<{ topic_id: string } | null> {
    const stored = await this.findStoredTopicForFile(absPath);
    if (stored === null) return null;
    await this.repository.delete(stored.id);
    this.repository.deleteFile(absPath);
    return { topic_id: stored.id };
  }

  async editFieldsAndLock(
    topicId: string,
    fields: TopicEditableFields,
    confirmedByUser: boolean,
  ): Promise<{ updated: LockedField[] }> {
    const path = this.repository.findFileById(this.projectDir, topicId);
    if (path === null) {
      throw new Error(`Topic file not found: ${topicId}`);
    }
    const file = this.repository.readFile(path);
    const next = applyTopicEdits(file, fields, confirmedByUser);
    if (next.changes.length === 0) return { updated: [] };
    this.persistFile(next.file, path);
    return { updated: next.changes };
  }

  generateTopicIds(count: number): { ids: string[] } {
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      throw new Error(
        `count must be an integer between 1 and 50; received ${count}`,
      );
    }
    const ids: string[] = [];
    for (let i = 0; i < count; i++) ids.push(newUuid());
    return { ids };
  }

  async getTopicConversationDetail(
    topicId: string,
    conversationId: string,
  ): Promise<TopicConversationDetail> {
    const file = await this.requireTopicFile(topicId);
    const conversation = await this.conversationsRepository.read(conversationId);
    if (conversation === null) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    const positions = file.items
      .filter(isIdeaUnitRefForConversation(conversationId))
      .map((item) => ({
        turn_index: item.turn_index,
        idea_unit_index: item.idea_unit_index,
      }));
    if (positions.length === 0) {
      throw new Error(
        `Conversation ${conversationId} not linked to topic ${topicId}`,
      );
    }
    const ideaUnits = await this.conversationsRepository.listIdeaUnitDetails(
      conversationId,
      positions,
    );
    return {
      topic_id: file.id,
      topic_title: file.title,
      conversation_id: conversation.id,
      conversation_title: conversation.main_topic,
      conversation_date: conversation.time,
      idea_units: ideaUnits.map((iu) => ({
        turn_index: iu.turn_index,
        idea_unit_index: iu.idea_unit_index,
        time: iu.time,
        speaker: iu.speaker,
        sentences: iu.sentences,
        categories: iu.categories,
      })),
    };
  }

  async getTopicDocumentDetail(
    topicId: string,
    documentId: string,
  ): Promise<TopicDocumentDetail> {
    const file = await this.requireTopicFile(topicId);
    const document = await this.documentsRepository.read(documentId);
    if (document === null) {
      throw new Error(`Document not found: ${documentId}`);
    }
    const ranges = file.items
      .filter(isFragmentRefForDocument(documentId))
      .map((item) => ({
        start_offset: item.start_offset,
        end_offset: item.end_offset,
      }));
    if (ranges.length === 0) {
      throw new Error(`Document ${documentId} not linked to topic ${topicId}`);
    }
    const content = (await this.documentsRepository.readContent(documentId)) ?? "";
    return {
      topic_id: file.id,
      topic_title: file.title,
      document_id: document.id,
      document_title: document.title,
      document_date: document.date,
      fragments: ranges.map((r) => ({
        start_offset: r.start_offset,
        end_offset: r.end_offset,
        text: content.slice(r.start_offset, r.end_offset).trim(),
      })),
    };
  }

  async getTopicsPage(): Promise<TopicsPageData> {
    const stored = await this.repository.listAll();
    const files = await this.readTopicFiles(stored);
    const refsByTopic = await this.collectCrossDomainRefs(files);
    return { topics: buildForest(stored, files, refsByTopic) };
  }

  async indexFile(absPath: string): Promise<IndexFileOutcome> {
    const sha = this.repository.fileSha(absPath);
    const file = this.repository.readFile(absPath);
    const stored = await this.repository.read(file.id);
    if (stored !== null && stored.sha === sha) {
      return { status: "unchanged", topic_id: file.id };
    }
    await this.repository.upsert(file, sha);
    return { status: "indexed", topic_id: file.id };
  }

  async listAllStoredFiles(): Promise<
    Array<{ id: string; path: string; sha: string }>
  > {
    return this.repository.listAllStoredFiles(this.projectDir);
  }

  async listTopicItemsSince(
    topicId: string,
    since: string | null,
  ): Promise<TopicItemEntry[]> {
    const file = await this.requireTopicFile(topicId);
    const ideaUnits = await this.resolveIdeaUnitItems(file.items, since);
    const fragments = await this.resolveFragmentItems(file.items, since);
    return [...ideaUnits, ...fragments];
  }

  async listTopicSummariesForSources(
    conversationIds: string[],
    documentIds: string[],
  ): Promise<TopicSummaryWithPath[]> {
    const conversationSet = new Set(conversationIds);
    const documentSet = new Set(documentIds);
    const stored = await this.repository.listAll();
    const out: TopicSummaryWithPath[] = [];
    for (const topic of stored) {
      const file = this.tryReadTopicFile(topic.id);
      if (file === null) continue;
      if (!fileReferencesAny(file, conversationSet, documentSet)) continue;
      const path = await this.computeTopicPath(topic.id);
      out.push({
        id: topic.id,
        title: topic.title,
        short_summary: topic.short_summary,
        long_summary: topic.long_summary,
        path,
      });
    }
    out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  }

  async listTopics(parentId: string | null): Promise<TopicOverview[]> {
    const children = await this.repository.listChildren(parentId);
    const out: TopicOverview[] = [];
    for (const topic of children) {
      const path = await this.computeTopicPath(topic.id);
      const grandchildren = await this.repository.listChildren(topic.id);
      out.push({
        id: topic.id,
        title: topic.title,
        short_summary: topic.short_summary,
        long_summary: topic.long_summary,
        has_subtopics: grandchildren.length > 0,
        path,
      });
    }
    return out;
  }

  async readStaleFlag(topicId: string): Promise<boolean | null> {
    return this.repository.readStaleFlag(topicId);
  }

  async readTopic(topicId: string): Promise<TopicDetail | null> {
    const stored = await this.repository.read(topicId);
    if (stored === null) return null;
    return {
      id: stored.id,
      title: stored.title,
      short_summary: stored.short_summary,
      long_summary: stored.long_summary,
      path: await this.computeTopicPath(topicId),
    };
  }

  async refreshStaleFlags(snapshot: SourceShaSnapshot): Promise<number> {
    const stored = await this.repository.listAll();
    let staleCount = 0;
    for (const topic of stored) {
      const path = this.repository.findFileById(this.projectDir, topic.id);
      if (path === null) continue;
      const file = this.repository.readFile(path);
      const isStale = computeStaleFromItems(file.items, snapshot);
      if (isStale !== file.is_stale) {
        const updated: TopicFileNew = { ...file, is_stale: isStale };
        this.repository.writeFile(path, updated);
      }
      if (isStale !== topic.is_stale) {
        await this.repository.writeStaleFlag(topic.id, isStale);
      }
      if (isStale) staleCount++;
    }
    return staleCount;
  }

  // ----- private helpers -----

  private async collectCrossDomainRefs(
    files: Map<string, TopicFileNew>,
  ): Promise<Map<string, TopicCrossRefs>> {
    const conversationIds = new Set<string>();
    const documentIds = new Set<string>();
    for (const file of files.values()) {
      for (const item of file.items) {
        if (item.type === "idea_unit_ref") conversationIds.add(item.conversation_id);
        else if (item.type === "document_fragment_ref") documentIds.add(item.document_id);
      }
    }
    const conversations = await this.conversationsRepository.listByIds(
      [...conversationIds],
    );
    const documents = await this.documentsRepository.listByIds([...documentIds]);
    const conversationById = new Map(conversations.map((c) => [c.id, c]));
    const documentById = new Map(documents.map((d) => [d.id, d]));

    const refs = new Map<string, TopicCrossRefs>();
    for (const [topicId, file] of files) {
      const seenConversations = new Set<string>();
      const seenDocuments = new Set<string>();
      const cs: TopicConversationRef[] = [];
      const ds: TopicDocumentRef[] = [];
      for (const item of file.items) {
        if (item.type === "idea_unit_ref") {
          if (seenConversations.has(item.conversation_id)) continue;
          seenConversations.add(item.conversation_id);
          const head = conversationById.get(item.conversation_id);
          if (head === undefined) continue;
          cs.push({ conversation_id: head.id, title: head.main_topic, date: head.time });
        } else if (item.type === "document_fragment_ref") {
          if (seenDocuments.has(item.document_id)) continue;
          seenDocuments.add(item.document_id);
          const head = documentById.get(item.document_id);
          if (head === undefined) continue;
          ds.push({ document_id: head.id, title: head.title, date: head.date });
        }
      }
      refs.set(topicId, { conversations: cs, documents: ds });
    }
    return refs;
  }

  private async computeTopicPath(topicId: string): Promise<string[]> {
    const titles: string[] = [];
    const visited = new Set<string>();
    let current: string | null = topicId;
    while (current !== null && !visited.has(current)) {
      visited.add(current);
      const node = await this.repository.read(current);
      if (node === null) break;
      titles.unshift(node.title);
      current = node.parent_id;
    }
    return titles;
  }

  private async readTopicFiles(
    stored: StoredTopic[],
  ): Promise<Map<string, TopicFileNew>> {
    const out = new Map<string, TopicFileNew>();
    for (const topic of stored) {
      const file = this.tryReadTopicFile(topic.id);
      if (file !== null) out.set(topic.id, file);
    }
    return out;
  }

  private async requireTopicFile(topicId: string): Promise<TopicFileNew> {
    const file = this.tryReadTopicFile(topicId);
    if (file === null) throw new Error(`Topic not found: ${topicId}`);
    return file;
  }

  private async resolveFragmentItems(
    items: SourceContentRef[],
    since: string | null,
  ): Promise<TopicDocumentFragmentItem[]> {
    const ranges = new Map<string, Array<{ start: number; end: number }>>();
    for (const item of items) {
      if (item.type !== "document_fragment_ref") continue;
      const list = ranges.get(item.document_id) ?? [];
      list.push({ start: item.start_offset, end: item.end_offset });
      ranges.set(item.document_id, list);
    }
    if (ranges.size === 0) return [];
    const heads = await this.documentsRepository.listByIds([...ranges.keys()]);
    const out: TopicDocumentFragmentItem[] = [];
    for (const head of heads) {
      if (since !== null && head.date <= since) continue;
      const content = (await this.documentsRepository.readContent(head.id)) ?? "";
      const list = ranges.get(head.id) ?? [];
      for (const { start, end } of list) {
        out.push({
          type: "document_fragment",
          document_id: head.id,
          document_title: head.title,
          document_date: head.date,
          start_offset: start,
          end_offset: end,
          text: content.slice(start, end).trim(),
        });
      }
    }
    out.sort((a, b) =>
      a.document_date === b.document_date
        ? a.start_offset - b.start_offset
        : b.document_date.localeCompare(a.document_date),
    );
    return out;
  }

  private async resolveIdeaUnitItems(
    items: SourceContentRef[],
    since: string | null,
  ): Promise<TopicIdeaUnitItem[]> {
    const positionsByConv = new Map<
      string,
      Array<{ turn_index: number; idea_unit_index: number }>
    >();
    for (const item of items) {
      if (item.type !== "idea_unit_ref") continue;
      const list = positionsByConv.get(item.conversation_id) ?? [];
      list.push({
        turn_index: item.turn_index,
        idea_unit_index: item.idea_unit_index,
      });
      positionsByConv.set(item.conversation_id, list);
    }
    if (positionsByConv.size === 0) return [];
    const heads = await this.conversationsRepository.listByIds(
      [...positionsByConv.keys()],
    );
    const out: TopicIdeaUnitItem[] = [];
    for (const head of heads) {
      if (since !== null && head.time <= since) continue;
      const positions = positionsByConv.get(head.id) ?? [];
      const details = await this.conversationsRepository.listIdeaUnitDetails(
        head.id,
        positions,
      );
      for (const iu of details) {
        if (iu.categories.length === 1 && iu.categories[0] === "Irrelevant") continue;
        out.push({
          type: "idea_unit",
          conversation_id: head.id,
          conversation_main_topic: head.main_topic,
          conversation_time: head.time,
          turn_index: iu.turn_index,
          idea_unit_index: iu.idea_unit_index,
          speaker: iu.speaker,
          time: iu.time,
          sentences: iu.sentences,
          categories: iu.categories,
        });
      }
    }
    out.sort((a, b) =>
      a.conversation_time === b.conversation_time
        ? a.turn_index - b.turn_index || a.idea_unit_index - b.idea_unit_index
        : b.conversation_time.localeCompare(a.conversation_time),
    );
    return out;
  }

  private async findStoredTopicForFile(
    absPath: string,
  ): Promise<StoredTopic | null> {
    const all = await this.repository.listAll();
    for (const topic of all) {
      const path = this.repository.canonicalPath(
        this.projectDir,
        topic.id,
        topic.title,
      );
      if (path === absPath) return topic;
    }
    return null;
  }

  private persistFile(file: TopicFileNew, previousPath: string | null): string {
    const newPath = this.canonicalPath(file.id, file.title);
    if (previousPath !== null && previousPath !== newPath) {
      this.repository.deleteFile(previousPath);
    }
    this.repository.writeFile(newPath, file);
    return newPath;
  }

  private tryReadTopicFile(topicId: string): TopicFileNew | null {
    const path = this.repository.findFileById(this.projectDir, topicId);
    if (path === null) return null;
    return this.repository.readFile(path);
  }
}

interface TopicCrossRefs {
  conversations: TopicConversationRef[];
  documents: TopicDocumentRef[];
}

interface ApplyResult {
  file: TopicFileNew;
  changes: LockedField[];
}

function applyTopicEdits(
  file: TopicFileNew,
  fields: TopicEditableFields,
  confirmedByUser: boolean,
): ApplyResult {
  const changes: LockedField[] = [];
  let next: TopicFileNew = file;
  if (fields.title !== undefined) {
    next = applyEdit(next, "title", "title_locked", fields.title, confirmedByUser, changes);
  }
  if (fields.short_summary !== undefined) {
    next = applyEdit(
      next,
      "short_summary",
      "short_summary_locked",
      fields.short_summary,
      confirmedByUser,
      changes,
    );
  }
  if (fields.long_summary !== undefined) {
    next = applyEdit(
      next,
      "long_summary",
      "long_summary_locked",
      fields.long_summary,
      confirmedByUser,
      changes,
    );
  }
  return { file: next, changes };
}

function applyEdit(
  file: TopicFileNew,
  fieldKey: "title" | "short_summary" | "long_summary",
  lockKey: "title_locked" | "short_summary_locked" | "long_summary_locked",
  newValue: string,
  confirmedByUser: boolean,
  changes: LockedField[],
): TopicFileNew {
  if (file[fieldKey] === newValue) return file;
  if (file[lockKey] && !confirmedByUser) {
    throw new Error(
      `Topic ${file.id}: field "${fieldKey}" is locked; pass confirmedByUser=true to override.`,
    );
  }
  changes.push(fieldKey);
  return { ...file, [fieldKey]: newValue, [lockKey]: true };
}

function buildForest(
  stored: StoredTopic[],
  files: Map<string, TopicFileNew>,
  refs: Map<string, TopicCrossRefs>,
): TopicNode[] {
  const nodeById = new Map<string, TopicNode>();
  for (const topic of stored) {
    const cross = refs.get(topic.id) ?? { conversations: [], documents: [] };
    const file = files.get(topic.id);
    nodeById.set(topic.id, {
      id: topic.id,
      title: topic.title,
      short_summary: topic.short_summary,
      long_summary: topic.long_summary,
      conversations: cross.conversations,
      documents: cross.documents,
      subtopics: [],
      is_stale: topic.is_stale,
      edited_by_user: hasUserLocks(file),
    });
  }
  const roots: TopicNode[] = [];
  for (const topic of stored) {
    const node = nodeById.get(topic.id);
    if (node === undefined) continue;
    if (topic.parent_id === null) {
      roots.push(node);
      continue;
    }
    const parent = nodeById.get(topic.parent_id);
    if (parent === undefined) {
      roots.push(node);
      continue;
    }
    parent.subtopics.push(node);
  }
  sortForestByTitle(roots);
  return roots;
}

function computeStaleFromItems(
  items: SourceContentRef[],
  snapshot: SourceShaSnapshot,
): boolean {
  for (const item of items) {
    if (item.source_sha === undefined) continue;
    const currentSha =
      item.type === "idea_unit_ref"
        ? snapshot.conversation.get(item.conversation_id)
        : snapshot.document.get(item.document_id);
    if (currentSha !== undefined && currentSha !== item.source_sha) return true;
  }
  return false;
}

function fileReferencesAny(
  file: TopicFileNew,
  conversationIds: Set<string>,
  documentIds: Set<string>,
): boolean {
  for (const item of file.items) {
    if (item.type === "idea_unit_ref" && conversationIds.has(item.conversation_id)) {
      return true;
    }
    if (
      item.type === "document_fragment_ref" &&
      documentIds.has(item.document_id)
    ) {
      return true;
    }
  }
  return false;
}

function hasUserLocks(file: TopicFileNew | undefined): boolean {
  if (file === undefined) return false;
  return file.title_locked || file.short_summary_locked || file.long_summary_locked;
}

function isFragmentRefForDocument(
  documentId: string,
): (item: SourceContentRef) => item is Extract<SourceContentRef, { type: "document_fragment_ref" }> {
  return (item): item is Extract<SourceContentRef, { type: "document_fragment_ref" }> => {
    if (item.type !== "document_fragment_ref") return false;
    return item.document_id === documentId;
  };
}

function isIdeaUnitRefForConversation(
  conversationId: string,
): (item: SourceContentRef) => item is Extract<SourceContentRef, { type: "idea_unit_ref" }> {
  return (item): item is Extract<SourceContentRef, { type: "idea_unit_ref" }> => {
    if (item.type !== "idea_unit_ref") return false;
    return item.conversation_id === conversationId;
  };
}

function sortForestByTitle(nodes: TopicNode[]): void {
  nodes.sort((a, b) => a.title.localeCompare(b.title));
  for (const n of nodes) sortForestByTitle(n.subtopics);
}
