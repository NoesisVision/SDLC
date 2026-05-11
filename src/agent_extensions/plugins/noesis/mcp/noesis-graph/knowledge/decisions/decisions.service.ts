import { Inject, Injectable } from "@nestjs/common";
import { rmSync } from "fs";
import { assertNever } from "../../../../shared-contracts/assert-never.js";
import type {
  DecisionFileNew,
  DecisionOptionNew,
  TopicItemRefNew,
} from "../../../../shared-contracts/source-file-schemas.js";
import { decisionJsonPath } from "../../../../shared-contracts/source-files.js";
import type {
  DecisionAlternativeData,
  DecisionConversationDetailData,
  DecisionConversationRef,
  DecisionDetailData,
  DecisionDocumentDetailData,
  DecisionDocumentRef,
  DecisionListItem,
  DecisionsPageData,
  DecisionSlotPath,
} from "../../ui-contracts/decisions/decisions-data.js";
import { PROJECT_DIR } from "../../config/config.module.js";
import { ConversationsRepository } from "../conversations/conversations.repository.js";
import { DocumentsRepository } from "../documents/documents.repository.js";
import type { SourceShaSnapshot } from "../topics/topics.service.js";
import { TopicsRepository } from "../topics/topics.repository.js";
import { DecisionsRepository } from "./decisions.repository.js";

export interface DecisionEditableTopFields {
  title?: string;
  status?: "accepted" | "proposed";
  context_text?: string;
  decision_text?: string;
  decision_rationale?: string;
}

export interface AlternativeOptionEdit {
  index: number;
  text?: string;
  rationale?: string;
}

export interface IndexFileOutcome {
  status: "indexed" | "unchanged";
  decision_id: string;
}

export type DecisionLockedField =
  | "title"
  | "status"
  | "context.text"
  | "decision.text"
  | "decision.rationale"
  | `alternative_options[${number}].text`
  | `alternative_options[${number}].rationale`;

export interface DecisionDetail {
  id: string;
  topic_id: string;
  topic_title: string;
  title: string;
  status: string;
  context_text: string;
  decision_text: string;
  decision_rationale: string;
  alternatives: Array<{
    option_index: number;
    text: string;
    rationale: string;
  }>;
}

export interface DecisionOverview {
  id: string;
  topic_id: string;
  topic_title: string;
  title: string;
  status: string;
  context_text: string;
}

type Slot =
  | { kind: "context" }
  | { kind: "decision" }
  | { kind: "alternative"; index: number };

@Injectable()
export class DecisionsService {
  constructor(
    @Inject(PROJECT_DIR) private readonly projectDir: string,
    private readonly repository: DecisionsRepository,
    private readonly topicsRepository: TopicsRepository,
    private readonly conversationsRepository: ConversationsRepository,
    private readonly documentsRepository: DocumentsRepository,
  ) {}

  async appendReferencedItems(
    decisionId: string,
    items: TopicItemRefNew[],
  ): Promise<{ appended: number }> {
    if (items.length === 0) return { appended: 0 };
    const path = this.canonicalPath(decisionId);
    if (!this.repository.fileExists(path)) {
      throw new Error(`Decision file not found: ${path}`);
    }
    const file = this.repository.readFile(path);
    const seen = new Set(file.referenced_items.map(itemKey));
    const additions: TopicItemRefNew[] = [];
    for (const item of items) {
      const key = itemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      additions.push(item);
    }
    if (additions.length === 0) return { appended: 0 };
    const nextFile: DecisionFileNew = {
      ...file,
      referenced_items: [...file.referenced_items, ...additions],
    };
    this.repository.writeFile(path, nextFile);
    return { appended: additions.length };
  }

  async deleteForFile(
    absPath: string,
  ): Promise<{ decision_id: string } | null> {
    const id = inferDecisionIdFromPath(absPath);
    if (id === null) return null;
    if (!(await this.repository.exists(id))) return null;
    await this.repository.delete(id);
    rmSync(decisionJsonPath(this.projectDir, id), { force: true });
    return { decision_id: id };
  }

  async editAlternativeOptionAndLock(
    decisionId: string,
    edit: AlternativeOptionEdit,
    confirmedByUser: boolean,
  ): Promise<{ updated: DecisionLockedField[] }> {
    const path = this.canonicalPath(decisionId);
    if (!this.repository.fileExists(path)) {
      throw new Error(`Decision file not found: ${path}`);
    }
    const file = this.repository.readFile(path);
    if (edit.index < 0 || edit.index >= file.alternative_options.length) {
      throw new Error(
        `Alternative option index ${edit.index} out of range (have ${file.alternative_options.length})`,
      );
    }
    const updated: DecisionLockedField[] = [];
    const updatedAlternatives = file.alternative_options.map((opt, i) => {
      if (i !== edit.index) return opt;
      let next = opt;
      if (edit.text !== undefined && next.text !== edit.text) {
        if (next.text_locked && !confirmedByUser) {
          throw new Error(
            `Decision ${decisionId}: alternative_options[${i}].text is locked; pass confirmedByUser=true to override.`,
          );
        }
        next = { ...next, text: edit.text, text_locked: true };
        updated.push(`alternative_options[${i}].text`);
      }
      if (edit.rationale !== undefined && next.rationale !== edit.rationale) {
        if (next.rationale_locked && !confirmedByUser) {
          throw new Error(
            `Decision ${decisionId}: alternative_options[${i}].rationale is locked; pass confirmedByUser=true to override.`,
          );
        }
        next = { ...next, rationale: edit.rationale, rationale_locked: true };
        updated.push(`alternative_options[${i}].rationale`);
      }
      return next;
    });
    if (updated.length === 0) return { updated: [] };
    const nextFile: DecisionFileNew = {
      ...file,
      alternative_options: updatedAlternatives,
    };
    this.repository.writeFile(path, nextFile);
    return { updated };
  }

  async getDecisionConversationDetail(
    decisionId: string,
    slotPath: DecisionSlotPath,
    conversationId: string,
  ): Promise<DecisionConversationDetailData> {
    const file = await this.requireFile(decisionId);
    const slot = parseSlotPath(slotPath);
    const positions = positionsForSlotConversation(file, slot, conversationId);
    if (positions.length === 0) {
      throw new Error(
        `Conversation ${conversationId} is not referenced by ${slotPath} slot of decision ${decisionId}`,
      );
    }
    const conversation = await this.conversationsRepository.read(conversationId);
    if (conversation === null) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    const ideaUnits = await this.conversationsRepository.listIdeaUnitDetails(
      conversationId,
      positions,
    );
    return {
      decision_id: file.id,
      decision_title: file.title,
      slot_label: slotLabel(slot),
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

  async getDecisionDetail(decisionId: string): Promise<DecisionDetailData> {
    const file = await this.requireFile(decisionId);
    const topicTitle = await this.lookupTopicTitle(file.topic_id);
    const conversationsById = await this.conversationsByIds(file);
    const documentsById = await this.documentsByIds(file);
    const date = decisionDate(file, conversationsById, documentsById);
    const slotRefs = (slot: Slot) =>
      slotItemRefs(file, slot).reduce(
        (acc, item) => mergeSlotRefs(acc, item, conversationsById, documentsById),
        { conversations: [] as DecisionConversationRef[], documents: [] as DecisionDocumentRef[] },
      );
    const ctx = slotRefs({ kind: "context" });
    const dec = slotRefs({ kind: "decision" });
    const alternatives: DecisionAlternativeData[] = file.alternative_options.map(
      (alt, index) => {
        const refs = slotRefs({ kind: "alternative", index });
        return {
          option_index: index,
          text: alt.text,
          rationale: alt.rationale,
          conversations: refs.conversations,
          documents: refs.documents,
        };
      },
    );
    return {
      id: file.id,
      topic_id: file.topic_id,
      topic_title: topicTitle,
      title: file.title,
      status: file.status,
      date,
      context_text: file.context.text,
      context_conversations: ctx.conversations,
      context_documents: ctx.documents,
      decision_text: file.decision.text,
      decision_rationale: file.decision.rationale,
      decision_conversations: dec.conversations,
      decision_documents: dec.documents,
      alternatives,
    };
  }

  async getDecisionDocumentDetail(
    decisionId: string,
    slotPath: DecisionSlotPath,
    documentId: string,
  ): Promise<DecisionDocumentDetailData> {
    const file = await this.requireFile(decisionId);
    const slot = parseSlotPath(slotPath);
    const ranges = rangesForSlotDocument(file, slot, documentId);
    if (ranges.length === 0) {
      throw new Error(
        `Document ${documentId} is not referenced by ${slotPath} slot of decision ${decisionId}`,
      );
    }
    const document = await this.documentsRepository.read(documentId);
    if (document === null) {
      throw new Error(`Document not found: ${documentId}`);
    }
    const content = (await this.documentsRepository.readContent(documentId)) ?? "";
    return {
      decision_id: file.id,
      decision_title: file.title,
      slot_label: slotLabel(slot),
      document_id: document.id,
      document_title: document.title,
      document_date: document.date,
      fragments: ranges.map((r) => ({
        start_offset: r.start,
        end_offset: r.end,
        text: content.slice(r.start, r.end).trim(),
      })),
    };
  }

  async getDecisionsPage(): Promise<DecisionsPageData> {
    const stored = await this.repository.listAll();
    const items: DecisionListItem[] = [];
    for (const head of stored) {
      const file = this.tryReadFile(head.id);
      if (file === null) continue;
      const conversationsById = await this.conversationsByIds(file);
      const documentsById = await this.documentsByIds(file);
      const date = decisionDate(file, conversationsById, documentsById);
      items.push({
        id: head.id,
        date,
        title: head.title,
        status: head.status,
        is_stale: head.is_stale,
        edited_by_user: hasUserLocks(file),
      });
    }
    items.sort(byDateDesc);
    return { decisions: items };
  }

  async listDecisions(topicId: string | null): Promise<DecisionOverview[]> {
    const heads =
      topicId === null
        ? await this.repository.listAll()
        : await this.repository.listByTopicId(topicId);
    const out: DecisionOverview[] = [];
    for (const head of heads) {
      const file = this.tryReadFile(head.id);
      if (file === null) continue;
      const topicTitle = await this.lookupTopicTitle(file.topic_id);
      out.push({
        id: head.id,
        topic_id: file.topic_id,
        topic_title: topicTitle,
        title: head.title,
        status: head.status,
        context_text: file.context.text,
      });
    }
    return out;
  }

  async listDecisionsForSources(
    conversationIds: string[],
    documentIds: string[],
  ): Promise<DecisionDetail[]> {
    const conversationSet = new Set(conversationIds);
    const documentSet = new Set(documentIds);
    const stored = await this.repository.listAll();
    const out: DecisionDetail[] = [];
    for (const head of stored) {
      const file = this.tryReadFile(head.id);
      if (file === null) continue;
      if (!fileReferencesAny(file, conversationSet, documentSet)) continue;
      const topicTitle = await this.lookupTopicTitle(file.topic_id);
      out.push({
        id: file.id,
        topic_id: file.topic_id,
        topic_title: topicTitle,
        title: file.title,
        status: file.status,
        context_text: file.context.text,
        decision_text: file.decision.text,
        decision_rationale: file.decision.rationale,
        alternatives: file.alternative_options.map((alt, i) => ({
          option_index: i,
          text: alt.text,
          rationale: alt.rationale,
        })),
      });
    }
    out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  }

  async readDecision(decisionId: string): Promise<DecisionDetail | null> {
    const file = this.tryReadFile(decisionId);
    if (file === null) return null;
    const topicTitle = await this.lookupTopicTitle(file.topic_id);
    return {
      id: file.id,
      topic_id: file.topic_id,
      topic_title: topicTitle,
      title: file.title,
      status: file.status,
      context_text: file.context.text,
      decision_text: file.decision.text,
      decision_rationale: file.decision.rationale,
      alternatives: file.alternative_options.map((alt, i) => ({
        option_index: i,
        text: alt.text,
        rationale: alt.rationale,
      })),
    };
  }

  async editTopFieldsAndLock(
    decisionId: string,
    fields: DecisionEditableTopFields,
    confirmedByUser: boolean,
  ): Promise<{ updated: DecisionLockedField[] }> {
    const path = this.canonicalPath(decisionId);
    if (!this.repository.fileExists(path)) {
      throw new Error(`Decision file not found: ${path}`);
    }
    const file = this.repository.readFile(path);
    const updated: DecisionLockedField[] = [];
    let next: DecisionFileNew = file;
    if (fields.title !== undefined && file.title !== fields.title) {
      if (file.title_locked && !confirmedByUser) {
        throw new Error(
          `Decision ${file.id}: field "title" is locked; pass confirmedByUser=true to override.`,
        );
      }
      next = { ...next, title: fields.title, title_locked: true };
      updated.push("title");
    }
    if (fields.status !== undefined && file.status !== fields.status) {
      if (file.status_locked && !confirmedByUser) {
        throw new Error(
          `Decision ${file.id}: field "status" is locked; pass confirmedByUser=true to override.`,
        );
      }
      next = { ...next, status: fields.status, status_locked: true };
      updated.push("status");
    }
    if (fields.context_text !== undefined) {
      next = applyContextEdit(next, fields.context_text, confirmedByUser, updated);
    }
    if (fields.decision_text !== undefined) {
      next = applyDecisionTextEdit(next, fields.decision_text, confirmedByUser, updated);
    }
    if (fields.decision_rationale !== undefined) {
      next = applyDecisionRationaleEdit(
        next,
        fields.decision_rationale,
        confirmedByUser,
        updated,
      );
    }
    if (updated.length === 0) return { updated: [] };
    this.repository.writeFile(path, next);
    return { updated };
  }

  async indexFile(absPath: string): Promise<IndexFileOutcome> {
    const sha = this.repository.fileSha(absPath);
    const file = this.repository.readFile(absPath);
    const stored = await this.repository.read(file.id);
    if (stored !== null && stored.sha === sha) {
      return { status: "unchanged", decision_id: file.id };
    }
    await this.repository.upsert(file, sha);
    return { status: "indexed", decision_id: file.id };
  }

  async listAllStoredFiles(): Promise<
    Array<{ id: string; path: string; sha: string }>
  > {
    return this.repository.listAllStoredFiles(this.projectDir);
  }

  async readStaleFlag(decisionId: string): Promise<boolean | null> {
    return this.repository.readStaleFlag(decisionId);
  }

  async refreshStaleFlags(snapshot: SourceShaSnapshot): Promise<number> {
    const stored = await this.repository.listAll();
    let staleCount = 0;
    for (const decision of stored) {
      const path = this.canonicalPath(decision.id);
      if (!this.repository.fileExists(path)) continue;
      const file = this.repository.readFile(path);
      const isStale = computeStale(file.referenced_items, snapshot);
      if (isStale !== file.is_stale) {
        const updated: DecisionFileNew = { ...file, is_stale: isStale };
        this.repository.writeFile(path, updated);
      }
      if (isStale !== decision.is_stale) {
        await this.repository.writeStaleFlag(decision.id, isStale);
      }
      if (isStale) staleCount++;
    }
    return staleCount;
  }

  private canonicalPath(decisionId: string): string {
    return this.repository.canonicalPath(this.projectDir, decisionId);
  }

  private async conversationsByIds(
    file: DecisionFileNew,
  ): Promise<Map<string, { id: string; main_topic: string; time: string }>> {
    const ids = uniqueRefIds(file.referenced_items, "idea_unit_ref");
    const heads = await this.conversationsRepository.listByIds(ids);
    return new Map(heads.map((c) => [c.id, c]));
  }

  private async documentsByIds(
    file: DecisionFileNew,
  ): Promise<Map<string, { id: string; title: string; date: string }>> {
    const ids = uniqueRefIds(file.referenced_items, "document_fragment_ref");
    const heads = await this.documentsRepository.listByIds(ids);
    return new Map(heads.map((d) => [d.id, d]));
  }

  private async lookupTopicTitle(topicId: string): Promise<string> {
    const topic = await this.topicsRepository.read(topicId);
    return topic?.title ?? "";
  }

  private async requireFile(decisionId: string): Promise<DecisionFileNew> {
    const file = this.tryReadFile(decisionId);
    if (file === null) throw new Error(`Decision not found: ${decisionId}`);
    return file;
  }

  private tryReadFile(decisionId: string): DecisionFileNew | null {
    const path = this.canonicalPath(decisionId);
    if (!this.repository.fileExists(path)) return null;
    return this.repository.readFile(path);
  }
}

function byDateDesc(a: { date: string }, b: { date: string }): number {
  if (a.date === b.date) return 0;
  if (a.date === "") return 1;
  if (b.date === "") return -1;
  return a.date < b.date ? 1 : -1;
}

function decisionDate(
  file: DecisionFileNew,
  conversationsById: Map<string, { time: string }>,
  documentsById: Map<string, { date: string }>,
): string {
  let max = "";
  for (const item of file.referenced_items) {
    if (item.type === "idea_unit_ref") {
      const head = conversationsById.get(item.conversation_id);
      if (head !== undefined && head.time > max) max = head.time;
    } else if (item.type === "document_fragment_ref") {
      const head = documentsById.get(item.document_id);
      if (head !== undefined && head.date > max) max = head.date;
    }
  }
  return max;
}

function fileReferencesAny(
  file: DecisionFileNew,
  conversationIds: Set<string>,
  documentIds: Set<string>,
): boolean {
  for (const item of file.referenced_items) {
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

function hasUserLocks(file: DecisionFileNew): boolean {
  if (file.title_locked || file.status_locked) return true;
  if (file.context.text_locked) return true;
  if (file.decision.text_locked || file.decision.rationale_locked) return true;
  return file.alternative_options.some(
    (alt) => alt.text_locked || alt.rationale_locked,
  );
}

function mergeSlotRefs(
  acc: { conversations: DecisionConversationRef[]; documents: DecisionDocumentRef[] },
  item: TopicItemRefNew,
  conversationsById: Map<string, { id: string; main_topic: string; time: string }>,
  documentsById: Map<string, { id: string; title: string; date: string }>,
): { conversations: DecisionConversationRef[]; documents: DecisionDocumentRef[] } {
  if (item.type === "idea_unit_ref") {
    if (acc.conversations.some((c) => c.conversation_id === item.conversation_id))
      return acc;
    const head = conversationsById.get(item.conversation_id);
    if (head === undefined) return acc;
    return {
      conversations: [
        ...acc.conversations,
        { conversation_id: head.id, title: head.main_topic, date: head.time },
      ],
      documents: acc.documents,
    };
  }
  if (item.type === "document_fragment_ref") {
    if (acc.documents.some((d) => d.document_id === item.document_id)) return acc;
    const head = documentsById.get(item.document_id);
    if (head === undefined) return acc;
    return {
      conversations: acc.conversations,
      documents: [
        ...acc.documents,
        { document_id: head.id, title: head.title, date: head.date },
      ],
    };
  }
  return acc;
}

function parseSlotPath(slot: DecisionSlotPath): Slot {
  if (slot === "context") return { kind: "context" };
  if (slot === "decision") return { kind: "decision" };
  const match = /^alternative-(\d+)$/.exec(slot);
  if (match === null) throw new Error(`Invalid decision slot path: ${slot}`);
  return { kind: "alternative", index: Number(match[1]) };
}

function positionsForSlotConversation(
  file: DecisionFileNew,
  slot: Slot,
  conversationId: string,
): Array<{ turn_index: number; idea_unit_index: number }> {
  const out: Array<{ turn_index: number; idea_unit_index: number }> = [];
  for (const item of slotItemRefs(file, slot)) {
    if (item.type !== "idea_unit_ref") continue;
    if (item.conversation_id !== conversationId) continue;
    out.push({
      turn_index: item.turn_index,
      idea_unit_index: item.idea_unit_index,
    });
  }
  return out;
}

function rangesForSlotDocument(
  file: DecisionFileNew,
  slot: Slot,
  documentId: string,
): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (const item of slotItemRefs(file, slot)) {
    if (item.type !== "document_fragment_ref") continue;
    if (item.document_id !== documentId) continue;
    out.push({ start: item.start_offset, end: item.end_offset });
  }
  return out;
}

function slotItemRefs(file: DecisionFileNew, slot: Slot): TopicItemRefNew[] {
  switch (slot.kind) {
    case "context":
      return pickItems(file.referenced_items, file.context.supporting_item_indices);
    case "decision":
      return pickItems(file.referenced_items, file.decision.supporting_item_indices);
    case "alternative": {
      const alt = file.alternative_options[slot.index];
      if (alt === undefined) return [];
      return pickItems(file.referenced_items, alt.supporting_item_indices);
    }
    default:
      return assertNever(slot);
  }
}

function slotLabel(slot: Slot): string {
  switch (slot.kind) {
    case "context":
      return "Context";
    case "decision":
      return "Decision";
    case "alternative":
      return `Option ${slot.index + 1}`;
    default:
      return assertNever(slot);
  }
}

function pickItems(
  items: TopicItemRefNew[],
  indices: number[],
): TopicItemRefNew[] {
  return indices
    .map((i) => items[i])
    .filter((item): item is TopicItemRefNew => item !== undefined);
}

function uniqueRefIds(
  items: TopicItemRefNew[],
  type: TopicItemRefNew["type"],
): string[] {
  const set = new Set<string>();
  for (const item of items) {
    if (item.type !== type) continue;
    set.add(
      item.type === "idea_unit_ref" ? item.conversation_id : item.document_id,
    );
  }
  return [...set];
}

function applyContextEdit(
  file: DecisionFileNew,
  newText: string,
  confirmedByUser: boolean,
  updated: DecisionLockedField[],
): DecisionFileNew {
  if (file.context.text === newText) return file;
  if (file.context.text_locked && !confirmedByUser) {
    throw new Error(
      `Decision ${file.id}: context.text is locked; pass confirmedByUser=true to override.`,
    );
  }
  updated.push("context.text");
  return {
    ...file,
    context: { ...file.context, text: newText, text_locked: true },
  };
}

function applyDecisionTextEdit(
  file: DecisionFileNew,
  newText: string,
  confirmedByUser: boolean,
  updated: DecisionLockedField[],
): DecisionFileNew {
  return applyDecisionOptionEdit(
    file,
    "text",
    "text_locked",
    "decision.text",
    newText,
    confirmedByUser,
    updated,
  );
}

function applyDecisionRationaleEdit(
  file: DecisionFileNew,
  newText: string,
  confirmedByUser: boolean,
  updated: DecisionLockedField[],
): DecisionFileNew {
  return applyDecisionOptionEdit(
    file,
    "rationale",
    "rationale_locked",
    "decision.rationale",
    newText,
    confirmedByUser,
    updated,
  );
}

function applyDecisionOptionEdit(
  file: DecisionFileNew,
  fieldKey: "text" | "rationale",
  lockKey: "text_locked" | "rationale_locked",
  reportKey: "decision.text" | "decision.rationale",
  newValue: string,
  confirmedByUser: boolean,
  updated: DecisionLockedField[],
): DecisionFileNew {
  const opt: DecisionOptionNew = file.decision;
  if (opt[fieldKey] === newValue) return file;
  if (opt[lockKey] && !confirmedByUser) {
    throw new Error(
      `Decision ${file.id}: ${reportKey} is locked; pass confirmedByUser=true to override.`,
    );
  }
  updated.push(reportKey);
  return { ...file, decision: { ...opt, [fieldKey]: newValue, [lockKey]: true } };
}

function computeStale(
  items: TopicItemRefNew[],
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

function itemKey(item: TopicItemRefNew): string {
  if (item.type === "idea_unit_ref") {
    return `iu:${item.conversation_id}:${item.turn_index}:${item.idea_unit_index}`;
  }
  return `doc:${item.document_id}:${item.start_offset}:${item.end_offset}`;
}

function inferDecisionIdFromPath(absPath: string): string | null {
  const match = /\/decisions\/([^/]+)\.json$/.exec(absPath);
  return match === null ? null : match[1];
}
