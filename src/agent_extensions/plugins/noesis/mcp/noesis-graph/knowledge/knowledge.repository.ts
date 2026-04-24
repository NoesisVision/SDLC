import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { DatabaseService } from "../database/database.service.js";
import { assertNever } from "../../../shared-contracts/assert-never.js";
import type {
  Decision,
  DecisionOption,
  TopicItem,
} from "../../../shared-contracts/topics.js";
import type {
  Conversation,
  IdeaUnit,
  IdeaUnitDetail,
  Turn,
} from "../../../shared-contracts/conversation.js";
import type { Document } from "../../../shared-contracts/documents.js";
import {
  alternativeOptionNodeId,
  documentFragmentNodeId,
  ideaUnitNodeId,
  turnNodeId,
} from "./node-ids.js";
import type { DecisionSupportSlot } from "./decision-support.js";

export const TopicOverviewSchema = z.object({
  id: z.string(),
  title: z.string(),
  short_summary: z.string(),
  long_summary: z.string(),
  has_subtopics: z.boolean(),
  path: z.array(z.string()),
});
export type TopicOverview = z.infer<typeof TopicOverviewSchema>;

const SCHEMA_STATEMENTS = [
  "CREATE NODE TABLE IF NOT EXISTS Topic(id STRING, title STRING, short_summary STRING, long_summary STRING, PRIMARY KEY(id))",
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
}

export interface TopicDetail {
  id: string;
  title: string;
  short_summary: string;
  long_summary: string;
  path: string[];
}

export interface DocumentFragmentDetail {
  document_id: string;
  document_title: string;
  start_offset: number;
  end_offset: number;
  text: string;
  section_path: string[];
}

export interface DecisionOverview {
  id: string;
  topic_id: string;
  topic_title: string;
  title: string;
  status: string;
  context_text: string;
}

export interface AlternativeRow {
  option_index: number;
  text: string;
  rationale: string;
}

export interface DecisionDetail {
  id: string;
  topic_id: string;
  topic_title: string;
  title: string;
  status: string;
  context_text: string;
  decision_text: string;
  decision_rationale: string;
  alternatives: AlternativeRow[];
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
      switch (slot.slot) {
        case "alternative": {
          const altId = alternativeOptionNodeId(decisionId, slot.alternative_index);
          await this.linkAlternativeToItem(altId, item);
          break;
        }
        case "context":
        case "decision":
          await this.linkDecisionSlotToItem(decisionId, slot, item);
          break;
        default:
          assertNever(slot);
      }
    }
  }

  async addItemsToTopic(topicId: string, items: TopicItem[]): Promise<void> {
    await this.requireTopic(topicId);
    await this.requireSupportingItems(items);

    for (const item of items) {
      switch (item.type) {
        case "idea_unit_ref": {
          const iuId = ideaUnitNodeId(
            item.conversation_id,
            item.turn_index,
            item.idea_unit_index,
          );
          if (await this.edgeExists("TOPIC_HAS_IDEA_UNIT", "Topic", topicId, "IdeaUnit", iuId)) break;
          await this.linkTopicToIdeaUnit(topicId, iuId);
          break;
        }
        case "document_fragment_ref": {
          const fragId = await this.ensureDocumentFragmentNode(
            item.document_id,
            item.start_offset,
            item.end_offset,
          );
          if (await this.edgeExists("TOPIC_HAS_DOCUMENT_FRAGMENT", "Topic", topicId, "DocumentFragment", fragId)) break;
          await this.linkTopicToDocumentFragment(topicId, fragId);
          break;
        }
        default:
          assertNever(item);
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

  async hasConversation(conversationId: string): Promise<boolean> {
    return this.nodeExists("Conversation", conversationId);
  }

  async hasDocument(documentId: string): Promise<boolean> {
    return this.nodeExists("Document", documentId);
  }

  async listDecisions(
    topicId: string | null,
  ): Promise<DecisionOverview[]> {
    const conn = this.db.getConnection();
    const query = topicId === null
      ? "MATCH (t:Topic)-[:TOPIC_HAS_DECISION]->(d:Decision) " +
        "RETURN d.id AS id, t.id AS topic_id, t.title AS topic_title, d.title AS title, d.status AS status, d.context_text AS context_text " +
        "ORDER BY t.title, d.title"
      : "MATCH (t:Topic)-[:TOPIC_HAS_DECISION]->(d:Decision) WHERE t.id = $topicId " +
        "RETURN d.id AS id, t.id AS topic_id, t.title AS topic_title, d.title AS title, d.status AS status, d.context_text AS context_text " +
        "ORDER BY d.title";
    const stmt = await conn.prepare(query);
    const result = topicId === null
      ? await conn.execute(stmt, {})
      : await conn.execute(stmt, { topicId });
    return asArray(result).getAllSync() as DecisionOverview[];
  }

  async readDecision(decisionId: string): Promise<DecisionDetail | null> {
    const conn = this.db.getConnection();
    const headStmt = await conn.prepare(
      "MATCH (t:Topic)-[:TOPIC_HAS_DECISION]->(d:Decision) WHERE d.id = $id " +
        "RETURN d.id AS id, t.id AS topic_id, t.title AS topic_title, d.title AS title, d.status AS status, " +
        "d.context_text AS context_text, d.decision_text AS decision_text, d.decision_rationale AS decision_rationale " +
        "LIMIT 1",
    );
    const headResult = await conn.execute(headStmt, { id: decisionId });
    const headRows = asArray(headResult).getAllSync() as Array<Omit<DecisionDetail, "alternatives">>;
    if (headRows.length === 0) return null;

    const altStmt = await conn.prepare(
      "MATCH (d:Decision)-[:DECISION_HAS_ALTERNATIVE]->(a:AlternativeOption) WHERE d.id = $id " +
        "RETURN a.option_index AS option_index, a.text AS text, a.rationale AS rationale " +
        "ORDER BY a.option_index",
    );
    const altResult = await conn.execute(altStmt, { id: decisionId });
    const altRows = asArray(altResult).getAllSync() as Array<{
      option_index: number | bigint;
      text: string;
      rationale: string;
    }>;

    return {
      ...headRows[0],
      alternatives: altRows.map((r) => ({
        option_index: Number(r.option_index),
        text: r.text,
        rationale: r.rationale,
      })),
    };
  }

  async getPriorDocumentFragments(
    topicId: string,
    excludeDocumentId: string,
  ): Promise<DocumentFragmentDetail[]> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "MATCH (t:Topic)-[:TOPIC_HAS_DOCUMENT_FRAGMENT]->(f:DocumentFragment)<-[:DOCUMENT_HAS_FRAGMENT]-(d:Document) " +
        "WHERE t.id = $topicId AND d.id <> $excludeDocumentId " +
        "RETURN d.id AS document_id, d.title AS document_title, d.content AS document_content, " +
        "f.start_offset AS start_offset, f.end_offset AS end_offset " +
        "ORDER BY d.id, f.start_offset",
    );
    const result = await conn.execute(stmt, { topicId, excludeDocumentId });
    const rows = asArray(result).getAllSync() as Array<{
      document_id: string;
      document_title: string;
      document_content: string;
      start_offset: number | bigint;
      end_offset: number | bigint;
    }>;
    return rows.map((r) => {
      const start = Number(r.start_offset);
      const end = Number(r.end_offset);
      return {
        document_id: r.document_id,
        document_title: r.document_title,
        start_offset: start,
        end_offset: end,
        text: r.document_content.slice(start, end).trim(),
        section_path: [],
      };
    });
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

  async listTopics(parentId: string | null): Promise<TopicOverview[]> {
    const rows = parentId === null
      ? await this.queryRootTopics()
      : await this.querySubtopics(parentId);
    const result: TopicOverview[] = [];
    for (const row of rows) {
      const path = await this.getTopicPath(row.id);
      const has_subtopics = await this.hasSubtopics(row.id);
      result.push({
        id: row.id,
        title: row.title,
        short_summary: row.short_summary,
        long_summary: row.long_summary,
        has_subtopics,
        path,
      });
    }
    return result;
  }

  async readTopic(topicId: string): Promise<TopicDetail | null> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "MATCH (t:Topic) WHERE t.id = $id RETURN t.id AS id, t.title AS title, t.short_summary AS short_summary, t.long_summary AS long_summary LIMIT 1",
    );
    const result = await conn.execute(stmt, { id: topicId });
    const rows = asArray(result).getAllSync() as Array<{
      id: string;
      title: string;
      short_summary: string;
      long_summary: string;
    }>;
    if (rows.length === 0) return null;
    const row = rows[0];
    const path = await this.getTopicPath(topicId);
    return {
      id: row.id,
      title: row.title,
      short_summary: row.short_summary,
      long_summary: row.long_summary,
      path,
    };
  }

  async getPriorIdeaUnits(
    topicId: string,
    excludeConversationId: string,
  ): Promise<IdeaUnitDetail[]> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "MATCH (t:Topic)-[:TOPIC_HAS_IDEA_UNIT]->(u:IdeaUnit)<-[:TURN_HAS_IDEA_UNIT]-(turn:Turn) " +
        "WHERE t.id = $topicId AND u.conversation_id <> $excludeConversationId " +
        "RETURN u.conversation_id AS conversation_id, u.turn_index AS turn_index, u.idea_unit_index AS idea_unit_index, " +
        "u.sentences AS sentences, u.categories AS categories, turn.speaker AS speaker, turn.time AS time " +
        "ORDER BY u.conversation_id, u.turn_index, u.idea_unit_index",
    );
    const result = await conn.execute(stmt, { topicId, excludeConversationId });
    const rows = asArray(result).getAllSync() as Array<{
      conversation_id: string;
      turn_index: number | bigint;
      idea_unit_index: number | bigint;
      sentences: string[];
      categories: string[];
      speaker: string;
      time: string;
    }>;
    return rows.map((r) => ({
      conversation_id: r.conversation_id,
      turn_index: Number(r.turn_index),
      idea_unit_index: Number(r.idea_unit_index),
      speaker: r.speaker,
      time: r.time,
      sentences: r.sentences,
      categories: r.categories as IdeaUnitDetail["categories"],
    }));
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

  async topicExists(topicId: string): Promise<boolean> {
    return this.nodeExists("Topic", topicId);
  }

  async updateTopicFields(
    topicId: string,
    fields: { title: string; short_summary: string; long_summary: string },
  ): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "MATCH (t:Topic) WHERE t.id = $id SET t.title = $title, t.short_summary = $short_summary, t.long_summary = $long_summary",
    );
    await conn.execute(stmt, {
      id: topicId,
      title: fields.title,
      short_summary: fields.short_summary,
      long_summary: fields.long_summary,
    });
  }

  private async deleteParentEdgeOf(topicId: string): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "MATCH (:Topic)-[r:TOPIC_HAS_SUBTOPIC]->(c:Topic) WHERE c.id = $id DELETE r",
    );
    await conn.execute(stmt, { id: topicId });
  }

  private async edgeExists(
    relName: string,
    fromLabel: string,
    fromId: string,
    toLabel: string,
    toId: string,
  ): Promise<boolean> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      `MATCH (a:${fromLabel})-[:${relName}]->(b:${toLabel}) WHERE a.id = $fromId AND b.id = $toId RETURN a.id AS id LIMIT 1`,
    );
    const result = await conn.execute(stmt, { fromId, toId });
    return asArray(result).getAllSync().length > 0;
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

  private async getTopicPath(topicId: string): Promise<string[]> {
    const titles: string[] = [];
    let currentId: string | null = topicId;
    const visited = new Set<string>();
    while (currentId !== null) {
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const conn = this.db.getConnection();
      const stmt = await conn.prepare(
        "MATCH (t:Topic) WHERE t.id = $id RETURN t.title AS title LIMIT 1",
      );
      const result = await conn.execute(stmt, { id: currentId });
      const rows = asArray(result).getAllSync() as Array<{ title: string }>;
      if (rows.length === 0) break;
      titles.unshift(rows[0].title);
      currentId = await this.findParentTopicId(currentId);
    }
    return titles;
  }

  private async findParentTopicId(topicId: string): Promise<string | null> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "MATCH (p:Topic)-[:TOPIC_HAS_SUBTOPIC]->(c:Topic) WHERE c.id = $id RETURN p.id AS id LIMIT 1",
    );
    const result = await conn.execute(stmt, { id: topicId });
    const rows = asArray(result).getAllSync() as Array<{ id: string }>;
    return rows.length === 0 ? null : rows[0].id;
  }

  private async hasSubtopics(topicId: string): Promise<boolean> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "MATCH (p:Topic)-[:TOPIC_HAS_SUBTOPIC]->(:Topic) WHERE p.id = $id RETURN p.id AS id LIMIT 1",
    );
    const result = await conn.execute(stmt, { id: topicId });
    return asArray(result).getAllSync().length > 0;
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
      "CREATE (t:Topic {id: $id, title: $title, short_summary: $short_summary, long_summary: $long_summary})",
    );
    await conn.execute(stmt, {
      id: topic.id,
      title: topic.title,
      short_summary: topic.short_summary,
      long_summary: topic.long_summary,
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
    switch (item.type) {
      case "idea_unit_ref": {
        const iuId = ideaUnitNodeId(
          item.conversation_id,
          item.turn_index,
          item.idea_unit_index,
        );
        const stmt = await conn.prepare(
          "MATCH (a:AlternativeOption), (u:IdeaUnit) WHERE a.id = $altId AND u.id = $iuId CREATE (a)-[:ALTERNATIVE_SUPPORTED_BY_IDEA_UNIT]->(u)",
        );
        await conn.execute(stmt, { altId, iuId });
        return;
      }
      case "document_fragment_ref": {
        const fragId = await this.ensureDocumentFragmentNode(
          item.document_id,
          item.start_offset,
          item.end_offset,
        );
        const stmt = await conn.prepare(
          "MATCH (a:AlternativeOption), (f:DocumentFragment) WHERE a.id = $altId AND f.id = $fragId CREATE (a)-[:ALTERNATIVE_SUPPORTED_BY_DOC_FRAGMENT]->(f)",
        );
        await conn.execute(stmt, { altId, fragId });
        return;
      }
      default:
        assertNever(item);
    }
  }

  private async linkDecisionSlotToItem(
    decisionId: string,
    slot: DecisionSupportSlot,
    item: TopicItem,
  ): Promise<void> {
    const conn = this.db.getConnection();
    const relName = decisionSlotRelName(slot, item.type);
    switch (item.type) {
      case "idea_unit_ref": {
        const iuId = ideaUnitNodeId(
          item.conversation_id,
          item.turn_index,
          item.idea_unit_index,
        );
        const stmt = await conn.prepare(
          `MATCH (d:Decision), (u:IdeaUnit) WHERE d.id = $decisionId AND u.id = $iuId CREATE (d)-[:${relName}]->(u)`,
        );
        await conn.execute(stmt, { decisionId, iuId });
        return;
      }
      case "document_fragment_ref": {
        const fragId = await this.ensureDocumentFragmentNode(
          item.document_id,
          item.start_offset,
          item.end_offset,
        );
        const stmt = await conn.prepare(
          `MATCH (d:Decision), (f:DocumentFragment) WHERE d.id = $decisionId AND f.id = $fragId CREATE (d)-[:${relName}]->(f)`,
        );
        await conn.execute(stmt, { decisionId, fragId });
        return;
      }
      default:
        assertNever(item);
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

  private async queryRootTopics(): Promise<Array<{ id: string; title: string; short_summary: string; long_summary: string }>> {
    const conn = this.db.getConnection();
    const result = await conn.query(
      "MATCH (t:Topic) WHERE NOT EXISTS { MATCH (:Topic)-[:TOPIC_HAS_SUBTOPIC]->(t) } " +
        "RETURN t.id AS id, t.title AS title, t.short_summary AS short_summary, t.long_summary AS long_summary " +
        "ORDER BY t.title",
    );
    return asArray(result).getAllSync() as Array<{
      id: string;
      title: string;
      short_summary: string;
      long_summary: string;
    }>;
  }

  private async querySubtopics(
    parentId: string,
  ): Promise<Array<{ id: string; title: string; short_summary: string; long_summary: string }>> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "MATCH (p:Topic)-[:TOPIC_HAS_SUBTOPIC]->(t:Topic) WHERE p.id = $parentId " +
        "RETURN t.id AS id, t.title AS title, t.short_summary AS short_summary, t.long_summary AS long_summary " +
        "ORDER BY t.title",
    );
    const result = await conn.execute(stmt, { parentId });
    return asArray(result).getAllSync() as Array<{
      id: string;
      title: string;
      short_summary: string;
      long_summary: string;
    }>;
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
      switch (item.type) {
        case "idea_unit_ref":
          await this.requireIdeaUnit(
            item.conversation_id,
            item.turn_index,
            item.idea_unit_index,
          );
          break;
        case "document_fragment_ref":
          if (!(await this.nodeExists("Document", item.document_id))) {
            throw new Error(`Document not found: ${item.document_id}`);
          }
          break;
        default:
          assertNever(item);
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
  const suffix = itemSuffix(itemType);
  switch (slot.slot) {
    case "context": return `CONTEXT_SUPPORTED_BY_${suffix}`;
    case "decision": return `DECISION_SUPPORTED_BY_${suffix}`;
    case "alternative": return `ALTERNATIVE_SUPPORTED_BY_${suffix}`;
    default: return assertNever(slot);
  }
}

function itemSuffix(itemType: TopicItem["type"]): string {
  switch (itemType) {
    case "idea_unit_ref": return "IDEA_UNIT";
    case "document_fragment_ref": return "DOC_FRAGMENT";
    default: return assertNever(itemType);
  }
}

function asArray(
  result: unknown,
): { getNumTuples(): number; getAllSync(): unknown[] } {
  if (Array.isArray(result)) return result[0];
  return result as { getNumTuples(): number; getAllSync(): unknown[] };
}
