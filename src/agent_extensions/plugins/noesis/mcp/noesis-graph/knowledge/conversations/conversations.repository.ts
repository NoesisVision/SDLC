import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { DatabaseService } from "../../database/database.service.js";
import type {
  Conversation,
  IdeaUnit,
  IdeaUnitDetail,
  Turn,
} from "../../../../shared-contracts/conversation.js";
import { ideaUnitNodeId, turnNodeId } from "./node-ids.js";

const IdRowSchema = z.object({ id: z.string() });
type IdRow = z.infer<typeof IdRowSchema>;

const IdeaUnitJoinRowSchema = z.object({
  conversation_id: z.string(),
  turn_index: z.union([z.number(), z.bigint()]),
  idea_unit_index: z.union([z.number(), z.bigint()]),
  sentences: z.array(z.string()),
  categories: z.array(z.string()),
  speaker: z.string(),
  time: z.string(),
});
type IdeaUnitJoinRow = z.infer<typeof IdeaUnitJoinRowSchema>;

const ConversationRefRowSchema = z.object({
  conversation_id: z.string(),
  main_topic: z.string(),
  time: z.string(),
});
type ConversationRefRow = z.infer<typeof ConversationRefRowSchema>;

const TopicRefRowSchema = z.object({
  topic_id: z.string(),
  title: z.string(),
});
type TopicRefRow = z.infer<typeof TopicRefRowSchema>;

const DecisionRefRowSchema = z.object({
  decision_id: z.string(),
  title: z.string(),
  status: z.string(),
});
type DecisionRefRow = z.infer<typeof DecisionRefRowSchema>;

export interface ConversationRef {
  conversation_id: string;
  main_topic: string;
  time: string;
}

export interface ConversationTopicRow {
  topic_id: string;
  title: string;
}

export interface ConversationDecisionRow {
  decision_id: string;
  title: string;
  status: string;
}

@Injectable()
export class ConversationsRepository {
  constructor(private readonly db: DatabaseService) {}

  async ensureNotExists(id: string): Promise<void> {
    if (await this.exists(id)) {
      throw new Error(`Conversation already exists: ${id}`);
    }
  }

  async exists(conversationId: string): Promise<boolean> {
    const rows = await this.db.query<IdRow>(
      "MATCH (c:Conversation) WHERE c.id = $id RETURN c.id AS id LIMIT 1",
      { id: conversationId },
    );
    return rows.length > 0;
  }

  async getPriorIdeaUnits(
    topicId: string,
    excludeConversationId: string,
  ): Promise<IdeaUnitDetail[]> {
    const rawRows = await this.db.query<IdeaUnitJoinRow>(
      "MATCH (t:Topic)-[:TOPIC_HAS_IDEA_UNIT]->(u:IdeaUnit)<-[:TURN_HAS_IDEA_UNIT]-(turn:Turn) " +
        "WHERE t.id = $topicId AND u.conversation_id <> $excludeConversationId " +
        "AND u.categories <> ['Irrelevant'] " +
        "RETURN u.conversation_id AS conversation_id, u.turn_index AS turn_index, u.idea_unit_index AS idea_unit_index, " +
        "u.sentences AS sentences, u.categories AS categories, turn.speaker AS speaker, turn.time AS time " +
        "ORDER BY u.conversation_id, u.turn_index, u.idea_unit_index",
      { topicId, excludeConversationId },
    );
    const rows = z.array(IdeaUnitJoinRowSchema).parse(rawRows);
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

  async insertConversation(conversation: Conversation): Promise<void> {
    await this.ensureNotExists(conversation.conversation_id);
    await this.insertConversationNode(conversation);
    for (const turn of conversation.turns) {
      await this.insertTurn(conversation.conversation_id, turn);
    }
  }

  async listAllConversations(): Promise<ConversationRef[]> {
    const rawRows = await this.db.query<ConversationRefRow>(
      "MATCH (c:Conversation) " +
        "RETURN c.id AS conversation_id, c.main_topic AS main_topic, c.time AS time " +
        "ORDER BY time DESC",
    );
    return z.array(ConversationRefRowSchema).parse(rawRows);
  }

  async listConversationsForTopic(topicId: string): Promise<ConversationRef[]> {
    const rawRows = await this.db.query<ConversationRefRow>(
      "MATCH (t:Topic)-[:TOPIC_HAS_IDEA_UNIT]->(:IdeaUnit)<-[:TURN_HAS_IDEA_UNIT]-(:Turn)<-[:CONVERSATION_HAS_TURN]-(c:Conversation) " +
        "WHERE t.id = $topicId " +
        "RETURN DISTINCT c.id AS conversation_id, c.main_topic AS main_topic, c.time AS time " +
        "ORDER BY time DESC",
      { topicId },
    );
    return z.array(ConversationRefRowSchema).parse(rawRows);
  }

  async listDecisionsForConversation(
    conversationId: string,
  ): Promise<ConversationDecisionRow[]> {
    const seen = new Set<string>();
    const out: ConversationDecisionRow[] = [];
    const queries = [
      "MATCH (d:Decision)-[:CONTEXT_SUPPORTED_BY_IDEA_UNIT]->(u:IdeaUnit) " +
        "WHERE u.conversation_id = $conversationId " +
        "RETURN DISTINCT d.id AS decision_id, d.title AS title, d.status AS status",
      "MATCH (d:Decision)-[:DECISION_SUPPORTED_BY_IDEA_UNIT]->(u:IdeaUnit) " +
        "WHERE u.conversation_id = $conversationId " +
        "RETURN DISTINCT d.id AS decision_id, d.title AS title, d.status AS status",
      "MATCH (d:Decision)-[:DECISION_HAS_ALTERNATIVE]->(:AlternativeOption)-[:ALTERNATIVE_SUPPORTED_BY_IDEA_UNIT]->(u:IdeaUnit) " +
        "WHERE u.conversation_id = $conversationId " +
        "RETURN DISTINCT d.id AS decision_id, d.title AS title, d.status AS status",
    ];
    for (const q of queries) {
      const rawRows = await this.db.query<DecisionRefRow>(q, { conversationId });
      for (const row of z.array(DecisionRefRowSchema).parse(rawRows)) {
        if (seen.has(row.decision_id)) continue;
        seen.add(row.decision_id);
        out.push(row);
      }
    }
    out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  }

  async listIdeaUnitsForTopicAndConversation(
    topicId: string,
    conversationId: string,
  ): Promise<IdeaUnitDetail[]> {
    const rawRows = await this.db.query<IdeaUnitJoinRow>(
      "MATCH (t:Topic)-[:TOPIC_HAS_IDEA_UNIT]->(u:IdeaUnit)<-[:TURN_HAS_IDEA_UNIT]-(turn:Turn) " +
        "WHERE t.id = $topicId AND u.conversation_id = $conversationId " +
        "AND u.categories <> ['Irrelevant'] " +
        "RETURN u.conversation_id AS conversation_id, u.turn_index AS turn_index, u.idea_unit_index AS idea_unit_index, " +
        "u.sentences AS sentences, u.categories AS categories, turn.speaker AS speaker, turn.time AS time " +
        "ORDER BY u.turn_index, u.idea_unit_index",
      { topicId, conversationId },
    );
    const rows = z.array(IdeaUnitJoinRowSchema).parse(rawRows);
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

  async listTopicsForConversation(
    conversationId: string,
  ): Promise<ConversationTopicRow[]> {
    const rawRows = await this.db.query<TopicRefRow>(
      "MATCH (t:Topic)-[:TOPIC_HAS_IDEA_UNIT]->(u:IdeaUnit) " +
        "WHERE u.conversation_id = $conversationId " +
        "RETURN DISTINCT t.id AS topic_id, t.title AS title " +
        "ORDER BY title",
      { conversationId },
    );
    return z.array(TopicRefRowSchema).parse(rawRows);
  }

  async readConversationHead(
    conversationId: string,
  ): Promise<ConversationRef | null> {
    const rawRows = await this.db.query<ConversationRefRow>(
      "MATCH (c:Conversation) WHERE c.id = $id " +
        "RETURN c.id AS conversation_id, c.main_topic AS main_topic, c.time AS time LIMIT 1",
      { id: conversationId },
    );
    if (rawRows.length === 0) return null;
    return ConversationRefRowSchema.parse(rawRows[0]);
  }

  async requireIdeaUnit(
    conversationId: string,
    turnIndex: number,
    ideaUnitIndex: number,
  ): Promise<void> {
    const id = ideaUnitNodeId(conversationId, turnIndex, ideaUnitIndex);
    const rows = await this.db.query<IdRow>(
      "MATCH (u:IdeaUnit) WHERE u.id = $id RETURN u.id AS id LIMIT 1",
      { id },
    );
    if (rows.length === 0) {
      throw new Error(
        `Idea unit not found: conversation=${conversationId} turn=${turnIndex} idea_unit=${ideaUnitIndex}`,
      );
    }
  }

  private async insertConversationNode(
    conversation: Conversation,
  ): Promise<void> {
    await this.db.query(
      "CREATE (c:Conversation {id: $id, time: $time, main_topic: $main_topic})",
      {
        id: conversation.conversation_id,
        time: conversation.time,
        main_topic: conversation.main_topic,
      },
    );
  }

  private async insertIdeaUnit(
    conversationId: string,
    turnIndex: number,
    ideaUnit: IdeaUnit,
  ): Promise<string> {
    const id = ideaUnitNodeId(conversationId, turnIndex, ideaUnit.index);
    await this.db.query(
      "CREATE (u:IdeaUnit {id: $id, conversation_id: $conversation_id, turn_index: $turn_index, idea_unit_index: $idea_unit_index, sentences: $sentences, categories: $categories})",
      {
        id,
        conversation_id: conversationId,
        turn_index: turnIndex,
        idea_unit_index: ideaUnit.index,
        sentences: ideaUnit.sentences,
        categories: ideaUnit.categories,
      },
    );
    return id;
  }

  private async insertTurn(
    conversationId: string,
    turn: Turn,
  ): Promise<void> {
    const turnId = turnNodeId(conversationId, turn.index);
    await this.db.query(
      "CREATE (t:Turn {id: $id, conversation_id: $conversation_id, turn_index: $turn_index, speaker: $speaker, time: $time})",
      {
        id: turnId,
        conversation_id: conversationId,
        turn_index: turn.index,
        speaker: turn.speaker,
        time: turn.time,
      },
    );

    await this.db.query(
      "MATCH (c:Conversation), (t:Turn) WHERE c.id = $conversationId AND t.id = $turnId CREATE (c)-[:CONVERSATION_HAS_TURN]->(t)",
      { conversationId, turnId },
    );

    for (const iu of turn.idea_units) {
      const iuId = await this.insertIdeaUnit(conversationId, turn.index, iu);
      await this.db.query(
        "MATCH (t:Turn), (u:IdeaUnit) WHERE t.id = $turnId AND u.id = $iuId CREATE (t)-[:TURN_HAS_IDEA_UNIT]->(u)",
        { turnId, iuId },
      );
    }
  }
}
