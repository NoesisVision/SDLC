import { Injectable } from "@nestjs/common";
import { assertNever } from "../../../../shared-contracts/assert-never.js";
import type {
  Decision,
  TopicItem,
} from "../../../../shared-contracts/topics.js";
import type {
  DecisionConversationDetailData,
  DecisionDetailData,
  DecisionDocumentDetailData,
  DecisionsPageData,
} from "../../ui-contracts/decisions/decisions-data.js";
import { ideaUnitNodeId } from "../conversations/node-ids.js";
import { ConversationsRepository } from "../conversations/conversations.repository.js";
import { DocumentsRepository } from "../documents/documents.repository.js";
import { TopicsRepository } from "../topics/topics.repository.js";
import {
  DecisionsRepository,
  type DecisionDetail,
  type DecisionOverview,
} from "./decisions.repository.js";
import type { DecisionSupportSlot } from "./decision-support.js";
import { alternativeOptionNodeId } from "./node-ids.js";

export type { DecisionSupportSlot } from "./decision-support.js";

@Injectable()
export class DecisionsService {
  constructor(
    private readonly repository: DecisionsRepository,
    private readonly topics: TopicsRepository,
    private readonly conversations: ConversationsRepository,
    private readonly documents: DocumentsRepository,
  ) {}

  async addDecision(
    topicId: string,
    decision: Decision,
  ): Promise<{ id: string }> {
    await this.topics.require(topicId);
    await this.requireSupportingItems(decision.referenced_items);
    await this.repository.ensureNotExists(decision.id);

    await this.repository.insertDecisionNode(decision);
    await this.repository.linkTopicToDecision(topicId, decision.id);

    for (const i of decision.context.supporting_item_indices) {
      await this.linkSlotToItem(
        decision.id,
        { slot: "context" },
        decision.referenced_items[i],
      );
    }
    for (const i of decision.decision.supporting_item_indices) {
      await this.linkSlotToItem(
        decision.id,
        { slot: "decision" },
        decision.referenced_items[i],
      );
    }

    for (let i = 0; i < decision.alternative_options.length; i++) {
      const alt = decision.alternative_options[i];
      const altId = alternativeOptionNodeId(decision.id, i);
      await this.repository.insertAlternativeOption(altId, i, alt);
      await this.repository.linkDecisionToAlternative(decision.id, altId);
      for (const idx of alt.supporting_item_indices) {
        await this.linkAlternativeToItem(altId, decision.referenced_items[idx]);
      }
    }
    return { id: decision.id };
  }

  async addItemsToDecisionSlot(
    decisionId: string,
    slot: DecisionSupportSlot,
    items: TopicItem[],
  ): Promise<{ added: number }> {
    await this.repository.requireDecision(decisionId);
    if (slot.slot === "alternative") {
      await this.repository.requireAlternative(decisionId, slot.alternative_index);
    }
    await this.requireSupportingItems(items);

    for (const item of items) {
      switch (slot.slot) {
        case "alternative": {
          const altId = alternativeOptionNodeId(decisionId, slot.alternative_index);
          await this.linkAlternativeToItem(altId, item);
          break;
        }
        case "context":
        case "decision":
          await this.linkSlotToItem(decisionId, slot, item);
          break;
        default:
          assertNever(slot);
      }
    }
    return { added: items.length };
  }

  async getDecisionDetail(decisionId: string): Promise<DecisionDetailData> {
    const detail = await this.repository.readDecision(decisionId);
    if (detail === null) throw new Error(`Decision not found: ${decisionId}`);
    const dateMap = await this.computeDecisionDates();
    const contextSlot: DecisionSupportSlot = { slot: "context" };
    const decisionSlot: DecisionSupportSlot = { slot: "decision" };
    const contextConversations =
      await this.repository.listConversationsForDecisionSlot(
        decisionId,
        contextSlot,
      );
    const contextDocuments =
      await this.repository.listDocumentsForDecisionSlot(decisionId, contextSlot);
    const decisionConversations =
      await this.repository.listConversationsForDecisionSlot(
        decisionId,
        decisionSlot,
      );
    const decisionDocuments =
      await this.repository.listDocumentsForDecisionSlot(
        decisionId,
        decisionSlot,
      );
    const alternatives = await Promise.all(
      detail.alternatives.map(async (a) => {
        const altSlot: DecisionSupportSlot = {
          slot: "alternative",
          alternative_index: a.option_index,
        };
        const conversations =
          await this.repository.listConversationsForDecisionSlot(
            decisionId,
            altSlot,
          );
        const documents = await this.repository.listDocumentsForDecisionSlot(
          decisionId,
          altSlot,
        );
        return {
          option_index: a.option_index,
          text: a.text,
          rationale: a.rationale,
          conversations,
          documents,
        };
      }),
    );
    return {
      id: detail.id,
      topic_id: detail.topic_id,
      topic_title: detail.topic_title,
      title: detail.title,
      status: detail.status,
      date: dateMap.get(detail.id) ?? "",
      context_text: detail.context_text,
      context_conversations: contextConversations,
      context_documents: contextDocuments,
      decision_text: detail.decision_text,
      decision_rationale: detail.decision_rationale,
      decision_conversations: decisionConversations,
      decision_documents: decisionDocuments,
      alternatives,
    };
  }

  async getDecisionConversationDetail(
    decisionId: string,
    slotPath: string,
    conversationId: string,
  ): Promise<DecisionConversationDetailData> {
    const slot = parseDecisionSlotPath(slotPath);
    const decision = await this.repository.readDecision(decisionId);
    if (decision === null) throw new Error(`Decision not found: ${decisionId}`);
    if (slot.slot === "alternative") {
      await this.repository.requireAlternative(
        decisionId,
        slot.alternative_index,
      );
    }
    const conversation = await this.repository.readConversationHead(conversationId);
    if (conversation === null) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    const ideaUnits =
      await this.repository.listIdeaUnitsForDecisionSlotAndConversation(
        decisionId,
        slot,
        conversationId,
      );
    return {
      decision_id: decision.id,
      decision_title: decision.title,
      slot_label: slotLabel(slot),
      conversation_id: conversation.conversation_id,
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

  async getDecisionDocumentDetail(
    decisionId: string,
    slotPath: string,
    documentId: string,
  ): Promise<DecisionDocumentDetailData> {
    const slot = parseDecisionSlotPath(slotPath);
    const decision = await this.repository.readDecision(decisionId);
    if (decision === null) throw new Error(`Decision not found: ${decisionId}`);
    if (slot.slot === "alternative") {
      await this.repository.requireAlternative(
        decisionId,
        slot.alternative_index,
      );
    }
    const document = await this.repository.readDocumentHead(documentId);
    if (document === null) {
      throw new Error(`Document not found: ${documentId}`);
    }
    const fragments =
      await this.repository.listFragmentsForDecisionSlotAndDocument(
        decisionId,
        slot,
        documentId,
      );
    return {
      decision_id: decision.id,
      decision_title: decision.title,
      slot_label: slotLabel(slot),
      document_id: document.document_id,
      document_title: document.title,
      document_date: document.date,
      fragments,
    };
  }

  async getDecisionsPage(): Promise<DecisionsPageData> {
    const overviews = await this.repository.listDecisions(null);
    const dateMap = await this.computeDecisionDates();
    const items = overviews.map((d) => ({
      id: d.id,
      date: dateMap.get(d.id) ?? "",
      title: d.title,
      status: d.status,
      is_stale: d.is_stale,
      edited_by_user: d.edited_by_user,
    }));
    items.sort(byDateDesc);
    return { decisions: items };
  }

  async listDecisions(topicId: string | null): Promise<DecisionOverview[]> {
    return this.repository.listDecisions(topicId);
  }

  async listDecisionsForSources(
    conversationIds: string[],
    documentIds: string[],
  ): Promise<DecisionDetail[]> {
    const ids = await this.repository.listDecisionIdsForSources(
      conversationIds,
      documentIds,
    );
    const out: DecisionDetail[] = [];
    for (const id of ids) {
      const detail = await this.repository.readDecision(id);
      if (detail !== null) out.push(detail);
    }
    out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  }

  async readDecision(decisionId: string): Promise<DecisionDetail | null> {
    return this.repository.readDecision(decisionId);
  }

  async updateDecisionEditableFields(
    decisionId: string,
    fields: Partial<{
      title: string;
      context_text: string;
      decision_text: string;
      decision_rationale: string;
    }>,
  ): Promise<void> {
    await this.repository.requireDecision(decisionId);
    const cleaned: Partial<{
      title: string;
      context_text: string;
      decision_text: string;
      decision_rationale: string;
    }> = {};
    if (fields.title !== undefined) {
      const trimmed = fields.title.trim();
      if (trimmed === "") throw new Error("Decision title must not be empty");
      cleaned.title = trimmed;
    }
    if (fields.context_text !== undefined) cleaned.context_text = fields.context_text;
    if (fields.decision_text !== undefined) cleaned.decision_text = fields.decision_text;
    if (fields.decision_rationale !== undefined)
      cleaned.decision_rationale = fields.decision_rationale;
    await this.repository.updateDecisionFields(decisionId, cleaned);
  }

  async updateAlternativeEditableFields(
    decisionId: string,
    optionIndex: number,
    fields: Partial<{ text: string; rationale: string }>,
  ): Promise<void> {
    await this.repository.requireDecision(decisionId);
    await this.repository.requireAlternative(decisionId, optionIndex);
    await this.repository.updateAlternativeFields(decisionId, optionIndex, fields);
  }

  private async computeDecisionDates(): Promise<Map<string, string>> {
    const entries = await this.repository.listDecisionSourceDates();
    const max = new Map<string, string>();
    for (const e of entries) {
      const cur = max.get(e.id);
      if (cur === undefined || e.date > cur) max.set(e.id, e.date);
    }
    return max;
  }

  private async linkAlternativeToItem(
    altId: string,
    item: TopicItem,
  ): Promise<void> {
    switch (item.type) {
      case "idea_unit_ref": {
        const iuId = ideaUnitNodeId(
          item.conversation_id,
          item.turn_index,
          item.idea_unit_index,
        );
        await this.repository.linkAlternativeToIdeaUnit(altId, iuId);
        return;
      }
      case "document_fragment_ref": {
        const fragId = await this.documents.ensureFragmentNode(
          item.document_id,
          item.start_offset,
          item.end_offset,
        );
        await this.repository.linkAlternativeToFragment(altId, fragId);
        return;
      }
      default:
        assertNever(item);
    }
  }

  private async linkSlotToItem(
    decisionId: string,
    slot: DecisionSupportSlot,
    item: TopicItem,
  ): Promise<void> {
    switch (item.type) {
      case "idea_unit_ref": {
        const iuId = ideaUnitNodeId(
          item.conversation_id,
          item.turn_index,
          item.idea_unit_index,
        );
        await this.repository.linkDecisionSlotToIdeaUnit(decisionId, slot, iuId);
        return;
      }
      case "document_fragment_ref": {
        const fragId = await this.documents.ensureFragmentNode(
          item.document_id,
          item.start_offset,
          item.end_offset,
        );
        await this.repository.linkDecisionSlotToFragment(decisionId, slot, fragId);
        return;
      }
      default:
        assertNever(item);
    }
  }

  private async requireSupportingItems(items: TopicItem[]): Promise<void> {
    for (const item of items) {
      switch (item.type) {
        case "idea_unit_ref":
          await this.conversations.requireIdeaUnit(
            item.conversation_id,
            item.turn_index,
            item.idea_unit_index,
          );
          break;
        case "document_fragment_ref":
          await this.documents.requireDocument(item.document_id);
          break;
        default:
          assertNever(item);
      }
    }
  }
}

function byDateDesc(
  a: { date: string },
  b: { date: string },
): number {
  if (a.date === b.date) return 0;
  if (a.date === "") return 1;
  if (b.date === "") return -1;
  return a.date < b.date ? 1 : -1;
}

function parseDecisionSlotPath(slotPath: string): DecisionSupportSlot {
  if (slotPath === "context") return { slot: "context" };
  if (slotPath === "decision") return { slot: "decision" };
  const altMatch = slotPath.match(/^alternative-(\d+)$/);
  if (altMatch !== null) {
    return {
      slot: "alternative",
      alternative_index: Number(altMatch[1]),
    };
  }
  throw new Error(`Invalid decision slot path: ${slotPath}`);
}

function slotLabel(slot: DecisionSupportSlot): string {
  switch (slot.slot) {
    case "context":
      return "Context";
    case "decision":
      return "Decision";
    case "alternative":
      return `Option ${slot.alternative_index + 1}`;
    default:
      return assertNever(slot);
  }
}
