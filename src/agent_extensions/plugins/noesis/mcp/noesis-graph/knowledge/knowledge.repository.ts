import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import type {
  Decision,
  DecisionOption,
  TopicItem,
} from "../../../shared-contracts/topics.js";
import type {
  Conversation,
  IdeaUnit,
  Turn,
} from "../../../shared-contracts/conversation.js";
import type { Document } from "../../../shared-contracts/documents.js";
import {
  alternativeOptionNodeId,
  documentFragmentNodeId,
  ideaUnitNodeId,
  turnNodeId,
  type DecisionSupportSlot,
} from "./knowledge.types.js";

const SCHEMA_STATEMENTS = [
  "CREATE NODE TABLE IF NOT EXISTS Topic(id STRING, title STRING, short_summary STRING, long_summary STRING, reviewed BOOL, decisions_extracted BOOL, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS Decision(id STRING, title STRING, status STRING, context_text STRING, decision_text STRING, decision_rationale STRING, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS AlternativeOption(id STRING, option_index INT64, text STRING, rationale STRING, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS Document(id STRING, title STRING, date STRING, content STRING, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DocumentFragment(id STRING, document_id STRING, start_offset INT64, end_offset INT64, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS Conversation(id STRING, time STRING, main_topic STRING, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS Turn(id STRING, conversation_id STRING, turn_index INT64, speaker STRING, time STRING, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS IdeaUnit(id STRING, conversation_id STRING, turn_index INT64, idea_unit_index INT64, sentences STRING[], categories STRING[], PRIMARY KEY(id))",
  "CREATE REL TABLE IF NOT EXISTS TOPIC_HAS_SUBTOPIC(FROM Topic TO Topic)",
  "CREATE REL TABLE IF NOT EXISTS TOPIC_HAS_IDEA_UNIT(FROM Topic TO IdeaUnit)",
  "CREATE REL TABLE IF NOT EXISTS TOPIC_HAS_DOCUMENT_FRAGMENT(FROM Topic TO DocumentFragment)",
  "CREATE REL TABLE IF NOT EXISTS TOPIC_HAS_DECISION(FROM Topic TO Decision)",
  "CREATE REL TABLE IF NOT EXISTS DECISION_HAS_ALTERNATIVE(FROM Decision TO AlternativeOption)",
  "CREATE REL TABLE IF NOT EXISTS CONTEXT_SUPPORTED_BY_IDEA_UNIT(FROM Decision TO IdeaUnit)",
  "CREATE REL TABLE IF NOT EXISTS CONTEXT_SUPPORTED_BY_DOC_FRAGMENT(FROM Decision TO DocumentFragment)",
  "CREATE REL TABLE IF NOT EXISTS DECISION_SUPPORTED_BY_IDEA_UNIT(FROM Decision TO IdeaUnit)",
  "CREATE REL TABLE IF NOT EXISTS DECISION_SUPPORTED_BY_DOC_FRAGMENT(FROM Decision TO DocumentFragment)",
  "CREATE REL TABLE IF NOT EXISTS ALTERNATIVE_SUPPORTED_BY_IDEA_UNIT(FROM AlternativeOption TO IdeaUnit)",
  "CREATE REL TABLE IF NOT EXISTS ALTERNATIVE_SUPPORTED_BY_DOC_FRAGMENT(FROM AlternativeOption TO DocumentFragment)",
  "CREATE REL TABLE IF NOT EXISTS CONVERSATION_HAS_TURN(FROM Conversation TO Turn)",
  "CREATE REL TABLE IF NOT EXISTS TURN_HAS_IDEA_UNIT(FROM Turn TO IdeaUnit)",
  "CREATE REL TABLE IF NOT EXISTS DOCUMENT_HAS_FRAGMENT(FROM Document TO DocumentFragment)",
];

export interface NewTopicInput {
  id: string;
  title: string;
  short_summary: string;
  long_summary: string;
  reviewed: boolean;
  decisions_extracted: boolean;
}

@Injectable()
export class KnowledgeRepository {
  private readonly logger = new Logger(KnowledgeRepository.name);

  constructor(private readonly db: DatabaseService) {}

  async addDecision(topicId: string, decision: Decision): Promise<void> {
    await this.requireTopic(topicId);
    await this.requireSupportingItems(decision.context.supporting_items);
    await this.requireSupportingItems(decision.decision.supporting_items);
    for (const alt of decision.alternative_options) {
      await this.requireSupportingItems(alt.supporting_items);
    }
    await this.ensureDecisionDoesNotExist(decision.id);

    await this.insertDecisionNode(decision);
    await this.linkTopicToDecision(topicId, decision.id);

    for (const item of decision.context.supporting_items) {
      await this.linkDecisionSlotToItem(decision.id, { slot: "context" }, item);
    }
    for (const item of decision.decision.supporting_items) {
      await this.linkDecisionSlotToItem(decision.id, { slot: "decision" }, item);
    }

    for (let i = 0; i < decision.alternative_options.length; i++) {
      const alt = decision.alternative_options[i];
      const altId = alternativeOptionNodeId(decision.id, i);
      await this.insertAlternativeOptionNode(altId, i, alt);
      await this.linkDecisionToAlternative(decision.id, altId);
      for (const item of alt.supporting_items) {
        await this.linkAlternativeToItem(altId, item);
      }
    }
  }

  async addItemsToDecisionSlot(
    decisionId: string,
    slot: DecisionSupportSlot,
    items: TopicItem[],
  ): Promise<void> {
    await this.requireDecision(decisionId);
    if (slot.slot === "alternative") {
      await this.requireAlternative(decisionId, slot.alternative_index);
    }
    await this.requireSupportingItems(items);

    for (const item of items) {
      if (slot.slot === "alternative") {
        const altId = alternativeOptionNodeId(decisionId, slot.alternative_index);
        await this.linkAlternativeToItem(altId, item);
      } else {
        await this.linkDecisionSlotToItem(decisionId, slot, item);
      }
    }
  }

  async addItemsToTopic(topicId: string, items: TopicItem[]): Promise<void> {
    await this.requireTopic(topicId);
    await this.requireSupportingItems(items);

    for (const item of items) {
      if (item.type === "conversation_idea_unit") {
        const iuId = ideaUnitNodeId(
          item.conversation_id,
          item.turn_index,
          item.idea_unit_index,
        );
        await this.linkTopicToIdeaUnit(topicId, iuId);
      } else {
        const fragId = await this.ensureDocumentFragmentNode(
          item.document_id,
          item.start_offset,
          item.end_offset,
        );
        await this.linkTopicToDocumentFragment(topicId, fragId);
      }
    }
  }

  async addTopic(topic: NewTopicInput): Promise<void> {
    await this.ensureTopicDoesNotExist(topic.id);
    await this.insertTopicNode(topic);
  }

  async addSubtopic(parentTopicId: string, topic: NewTopicInput): Promise<void> {
    await this.requireTopic(parentTopicId);
    await this.ensureTopicDoesNotExist(topic.id);
    await this.insertTopicNode(topic);
    await this.linkTopicToSubtopic(parentTopicId, topic.id);
  }

  async insertConversation(conversation: Conversation): Promise<void> {
    await this.ensureConversationDoesNotExist(conversation.conversation_id);
    await this.insertConversationNode(conversation);
    for (const turn of conversation.turns) {
      await this.insertTurnForConversation(conversation.conversation_id, turn);
    }
  }

  async insertDocument(document: Document): Promise<void> {
    await this.ensureDocumentDoesNotExist(document.id);
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "CREATE (d:Document {id: $id, title: $title, date: $date, content: $content})",
    );
    await conn.execute(stmt, {
      id: document.id,
      title: document.title,
      date: document.date,
      content: document.content,
    });
  }

  async initSchema(): Promise<void> {
    const conn = this.db.getConnection();
    for (const stmt of SCHEMA_STATEMENTS) {
      await conn.query(stmt);
    }
    this.logger.log("Knowledge graph schema initialized");
  }

  async reparentTopic(
    topicId: string,
    newParentTopicId: string | null,
  ): Promise<void> {
    await this.requireTopic(topicId);
    if (newParentTopicId !== null) {
      await this.requireTopic(newParentTopicId);
      if (newParentTopicId === topicId) {
        throw new Error(`Topic cannot be its own parent: ${topicId}`);
      }
    }
    await this.deleteParentEdgeOf(topicId);
    if (newParentTopicId !== null) {
      await this.linkTopicToSubtopic(newParentTopicId, topicId);
    }
  }

  private async deleteParentEdgeOf(topicId: string): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "MATCH (:Topic)-[r:TOPIC_HAS_SUBTOPIC]->(c:Topic) WHERE c.id = $id DELETE r",
    );
    await conn.execute(stmt, { id: topicId });
  }

  private async ensureConversationDoesNotExist(id: string): Promise<void> {
    if (await this.nodeExists("Conversation", id)) {
      throw new Error(`Conversation already exists: ${id}`);
    }
  }

  private async ensureDecisionDoesNotExist(id: string): Promise<void> {
    if (await this.nodeExists("Decision", id)) {
      throw new Error(`Decision already exists: ${id}`);
    }
  }

  private async ensureDocumentDoesNotExist(id: string): Promise<void> {
    if (await this.nodeExists("Document", id)) {
      throw new Error(`Document already exists: ${id}`);
    }
  }

  private async ensureDocumentFragmentNode(
    documentId: string,
    startOffset: number,
    endOffset: number,
  ): Promise<string> {
    if (!(await this.nodeExists("Document", documentId))) {
      throw new Error(`Document not found: ${documentId}`);
    }
    const fragId = documentFragmentNodeId(documentId, startOffset, endOffset);
    if (await this.nodeExists("DocumentFragment", fragId)) {
      return fragId;
    }
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "CREATE (f:DocumentFragment {id: $id, document_id: $document_id, start_offset: $start_offset, end_offset: $end_offset})",
    );
    await conn.execute(stmt, {
      id: fragId,
      document_id: documentId,
      start_offset: startOffset,
      end_offset: endOffset,
    });
    const linkStmt = await conn.prepare(
      "MATCH (d:Document), (f:DocumentFragment) WHERE d.id = $documentId AND f.id = $fragId CREATE (d)-[:DOCUMENT_HAS_FRAGMENT]->(f)",
    );
    await conn.execute(linkStmt, { documentId, fragId });
    return fragId;
  }

  private async ensureTopicDoesNotExist(id: string): Promise<void> {
    if (await this.nodeExists("Topic", id)) {
      throw new Error(`Topic already exists: ${id}`);
    }
  }

  private async insertAlternativeOptionNode(
    altId: string,
    optionIndex: number,
    option: DecisionOption,
  ): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "CREATE (a:AlternativeOption {id: $id, option_index: $option_index, text: $text, rationale: $rationale})",
    );
    await conn.execute(stmt, {
      id: altId,
      option_index: optionIndex,
      text: option.text,
      rationale: option.rationale,
    });
  }

  private async insertConversationNode(
    conversation: Conversation,
  ): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "CREATE (c:Conversation {id: $id, time: $time, main_topic: $main_topic})",
    );
    await conn.execute(stmt, {
      id: conversation.conversation_id,
      time: conversation.time,
      main_topic: conversation.main_topic,
    });
  }

  private async insertDecisionNode(decision: Decision): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "CREATE (d:Decision {id: $id, title: $title, status: $status, context_text: $context_text, decision_text: $decision_text, decision_rationale: $decision_rationale})",
    );
    await conn.execute(stmt, {
      id: decision.id,
      title: decision.title,
      status: decision.status,
      context_text: decision.context.text,
      decision_text: decision.decision.text,
      decision_rationale: decision.decision.rationale,
    });
  }

  private async insertIdeaUnitNode(
    conversationId: string,
    turnIndex: number,
    ideaUnit: IdeaUnit,
  ): Promise<string> {
    const id = ideaUnitNodeId(conversationId, turnIndex, ideaUnit.index);
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "CREATE (u:IdeaUnit {id: $id, conversation_id: $conversation_id, turn_index: $turn_index, idea_unit_index: $idea_unit_index, sentences: $sentences, categories: $categories})",
    );
    await conn.execute(stmt, {
      id,
      conversation_id: conversationId,
      turn_index: turnIndex,
      idea_unit_index: ideaUnit.index,
      sentences: ideaUnit.sentences,
      categories: ideaUnit.categories,
    });
    return id;
  }

  private async insertTopicNode(topic: NewTopicInput): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "CREATE (t:Topic {id: $id, title: $title, short_summary: $short_summary, long_summary: $long_summary, reviewed: $reviewed, decisions_extracted: $decisions_extracted})",
    );
    await conn.execute(stmt, {
      id: topic.id,
      title: topic.title,
      short_summary: topic.short_summary,
      long_summary: topic.long_summary,
      reviewed: topic.reviewed,
      decisions_extracted: topic.decisions_extracted,
    });
  }

  private async insertTurnForConversation(
    conversationId: string,
    turn: Turn,
  ): Promise<void> {
    const turnId = turnNodeId(conversationId, turn.index);
    const conn = this.db.getConnection();
    const turnStmt = await conn.prepare(
      "CREATE (t:Turn {id: $id, conversation_id: $conversation_id, turn_index: $turn_index, speaker: $speaker, time: $time})",
    );
    await conn.execute(turnStmt, {
      id: turnId,
      conversation_id: conversationId,
      turn_index: turn.index,
      speaker: turn.speaker,
      time: turn.time,
    });

    const linkTurnStmt = await conn.prepare(
      "MATCH (c:Conversation), (t:Turn) WHERE c.id = $conversationId AND t.id = $turnId CREATE (c)-[:CONVERSATION_HAS_TURN]->(t)",
    );
    await conn.execute(linkTurnStmt, { conversationId, turnId });

    for (const iu of turn.idea_units) {
      const iuId = await this.insertIdeaUnitNode(conversationId, turn.index, iu);
      const linkIuStmt = await conn.prepare(
        "MATCH (t:Turn), (u:IdeaUnit) WHERE t.id = $turnId AND u.id = $iuId CREATE (t)-[:TURN_HAS_IDEA_UNIT]->(u)",
      );
      await conn.execute(linkIuStmt, { turnId, iuId });
    }
  }

  private async linkAlternativeToItem(
    altId: string,
    item: TopicItem,
  ): Promise<void> {
    const conn = this.db.getConnection();
    if (item.type === "conversation_idea_unit") {
      const iuId = ideaUnitNodeId(
        item.conversation_id,
        item.turn_index,
        item.idea_unit_index,
      );
      const stmt = await conn.prepare(
        "MATCH (a:AlternativeOption), (u:IdeaUnit) WHERE a.id = $altId AND u.id = $iuId CREATE (a)-[:ALTERNATIVE_SUPPORTED_BY_IDEA_UNIT]->(u)",
      );
      await conn.execute(stmt, { altId, iuId });
    } else {
      const fragId = await this.ensureDocumentFragmentNode(
        item.document_id,
        item.start_offset,
        item.end_offset,
      );
      const stmt = await conn.prepare(
        "MATCH (a:AlternativeOption), (f:DocumentFragment) WHERE a.id = $altId AND f.id = $fragId CREATE (a)-[:ALTERNATIVE_SUPPORTED_BY_DOC_FRAGMENT]->(f)",
      );
      await conn.execute(stmt, { altId, fragId });
    }
  }

  private async linkDecisionSlotToItem(
    decisionId: string,
    slot: DecisionSupportSlot,
    item: TopicItem,
  ): Promise<void> {
    const conn = this.db.getConnection();
    const relName = decisionSlotRelName(slot, item.type);
    if (item.type === "conversation_idea_unit") {
      const iuId = ideaUnitNodeId(
        item.conversation_id,
        item.turn_index,
        item.idea_unit_index,
      );
      const stmt = await conn.prepare(
        `MATCH (d:Decision), (u:IdeaUnit) WHERE d.id = $decisionId AND u.id = $iuId CREATE (d)-[:${relName}]->(u)`,
      );
      await conn.execute(stmt, { decisionId, iuId });
    } else {
      const fragId = await this.ensureDocumentFragmentNode(
        item.document_id,
        item.start_offset,
        item.end_offset,
      );
      const stmt = await conn.prepare(
        `MATCH (d:Decision), (f:DocumentFragment) WHERE d.id = $decisionId AND f.id = $fragId CREATE (d)-[:${relName}]->(f)`,
      );
      await conn.execute(stmt, { decisionId, fragId });
    }
  }

  private async linkDecisionToAlternative(
    decisionId: string,
    altId: string,
  ): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "MATCH (d:Decision), (a:AlternativeOption) WHERE d.id = $decisionId AND a.id = $altId CREATE (d)-[:DECISION_HAS_ALTERNATIVE]->(a)",
    );
    await conn.execute(stmt, { decisionId, altId });
  }

  private async linkTopicToDecision(
    topicId: string,
    decisionId: string,
  ): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "MATCH (t:Topic), (d:Decision) WHERE t.id = $topicId AND d.id = $decisionId CREATE (t)-[:TOPIC_HAS_DECISION]->(d)",
    );
    await conn.execute(stmt, { topicId, decisionId });
  }

  private async linkTopicToDocumentFragment(
    topicId: string,
    fragId: string,
  ): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "MATCH (t:Topic), (f:DocumentFragment) WHERE t.id = $topicId AND f.id = $fragId CREATE (t)-[:TOPIC_HAS_DOCUMENT_FRAGMENT]->(f)",
    );
    await conn.execute(stmt, { topicId, fragId });
  }

  private async linkTopicToIdeaUnit(
    topicId: string,
    iuId: string,
  ): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "MATCH (t:Topic), (u:IdeaUnit) WHERE t.id = $topicId AND u.id = $iuId CREATE (t)-[:TOPIC_HAS_IDEA_UNIT]->(u)",
    );
    await conn.execute(stmt, { topicId, iuId });
  }

  private async linkTopicToSubtopic(
    parentId: string,
    childId: string,
  ): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "MATCH (p:Topic), (c:Topic) WHERE p.id = $parentId AND c.id = $childId CREATE (p)-[:TOPIC_HAS_SUBTOPIC]->(c)",
    );
    await conn.execute(stmt, { parentId, childId });
  }

  private async nodeExists(label: string, id: string): Promise<boolean> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      `MATCH (n:${label}) WHERE n.id = $id RETURN n.id AS id LIMIT 1`,
    );
    const result = await conn.execute(stmt, { id });
    const rows = asArray(result).getAllSync();
    return rows.length > 0;
  }

  private async requireAlternative(
    decisionId: string,
    optionIndex: number,
  ): Promise<void> {
    const altId = alternativeOptionNodeId(decisionId, optionIndex);
    if (!(await this.nodeExists("AlternativeOption", altId))) {
      throw new Error(
        `Alternative option not found for decision ${decisionId} at index ${optionIndex}`,
      );
    }
  }

  private async requireDecision(id: string): Promise<void> {
    if (!(await this.nodeExists("Decision", id))) {
      throw new Error(`Decision not found: ${id}`);
    }
  }

  private async requireIdeaUnit(
    conversationId: string,
    turnIndex: number,
    ideaUnitIndex: number,
  ): Promise<void> {
    const id = ideaUnitNodeId(conversationId, turnIndex, ideaUnitIndex);
    if (!(await this.nodeExists("IdeaUnit", id))) {
      throw new Error(
        `Idea unit not found: conversation=${conversationId} turn=${turnIndex} idea_unit=${ideaUnitIndex}`,
      );
    }
  }

  private async requireSupportingItems(items: TopicItem[]): Promise<void> {
    for (const item of items) {
      if (item.type === "conversation_idea_unit") {
        await this.requireIdeaUnit(
          item.conversation_id,
          item.turn_index,
          item.idea_unit_index,
        );
      } else {
        if (!(await this.nodeExists("Document", item.document_id))) {
          throw new Error(`Document not found: ${item.document_id}`);
        }
      }
    }
  }

  private async requireTopic(id: string): Promise<void> {
    if (!(await this.nodeExists("Topic", id))) {
      throw new Error(`Topic not found: ${id}`);
    }
  }
}

function decisionSlotRelName(
  slot: DecisionSupportSlot,
  itemType: TopicItem["type"],
): string {
  const suffix = itemType === "conversation_idea_unit"
    ? "IDEA_UNIT"
    : "DOC_FRAGMENT";
  if (slot.slot === "context") return `CONTEXT_SUPPORTED_BY_${suffix}`;
  if (slot.slot === "decision") return `DECISION_SUPPORTED_BY_${suffix}`;
  return `ALTERNATIVE_SUPPORTED_BY_${suffix}`;
}

function asArray(
  result: unknown,
): { getNumTuples(): number; getAllSync(): unknown[] } {
  if (Array.isArray(result)) return result[0];
  return result as { getNumTuples(): number; getAllSync(): unknown[] };
}
