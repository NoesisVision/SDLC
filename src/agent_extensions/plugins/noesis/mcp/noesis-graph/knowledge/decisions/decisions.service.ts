import { Injectable } from "@nestjs/common";
import { assertNever } from "../../../../shared-contracts/assert-never.js";
import type {
  Decision,
  TopicItem,
} from "../../../../shared-contracts/topics.js";
import type {
  DecisionDetailData,
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
    await this.requireSupportingItems(decision.context.supporting_items);
    await this.requireSupportingItems(decision.decision.supporting_items);
    for (const alt of decision.alternative_options) {
      await this.requireSupportingItems(alt.supporting_items);
    }
    await this.repository.ensureNotExists(decision.id);

    await this.repository.insertDecisionNode(decision);
    await this.repository.linkTopicToDecision(topicId, decision.id);

    for (const item of decision.context.supporting_items) {
      await this.linkSlotToItem(decision.id, { slot: "context" }, item);
    }
    for (const item of decision.decision.supporting_items) {
      await this.linkSlotToItem(decision.id, { slot: "decision" }, item);
    }

    for (let i = 0; i < decision.alternative_options.length; i++) {
      const alt = decision.alternative_options[i];
      const altId = alternativeOptionNodeId(decision.id, i);
      await this.repository.insertAlternativeOption(altId, i, alt);
      await this.repository.linkDecisionToAlternative(decision.id, altId);
      for (const item of alt.supporting_items) {
        await this.linkAlternativeToItem(altId, item);
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
    return {
      id: detail.id,
      topic_id: detail.topic_id,
      topic_title: detail.topic_title,
      title: detail.title,
      status: detail.status,
      date: dateMap.get(detail.id) ?? "",
      context_text: detail.context_text,
      decision_text: detail.decision_text,
      decision_rationale: detail.decision_rationale,
      alternatives: detail.alternatives.map((a) => ({
        option_index: a.option_index,
        text: a.text,
        rationale: a.rationale,
      })),
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
