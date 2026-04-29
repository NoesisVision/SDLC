import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { DatabaseService } from "../../database/database.service.js";

const TopicRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  short_summary: z.string(),
  long_summary: z.string(),
});
type TopicRow = z.infer<typeof TopicRowSchema>;

const IdRowSchema = z.object({ id: z.string() });
type IdRow = z.infer<typeof IdRowSchema>;

const TitleRowSchema = z.object({ title: z.string() });
type TitleRow = z.infer<typeof TitleRowSchema>;

export const TopicOverviewSchema = z.object({
  id: z.string(),
  title: z.string(),
  short_summary: z.string(),
  long_summary: z.string(),
  has_subtopics: z.boolean(),
  path: z.array(z.string()),
});
export type TopicOverview = z.infer<typeof TopicOverviewSchema>;

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

export interface TopicWithParent {
  id: string;
  title: string;
  short_summary: string;
  long_summary: string;
  parent_id: string | null;
}

export interface TopicSummaryRow {
  id: string;
  title: string;
  short_summary: string;
  long_summary: string;
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
export class TopicsRepository {
  constructor(private readonly db: DatabaseService) {}

  async deleteParentEdge(topicId: string): Promise<void> {
    await this.db.query(
      "MATCH (:Topic)-[r:TOPIC_HAS_SUBTOPIC]->(c:Topic) WHERE c.id = $id DELETE r",
      { id: topicId },
    );
  }

  async ensureNotExists(topicId: string): Promise<void> {
    if (await this.exists(topicId)) {
      throw new Error(`Topic already exists: ${topicId}`);
    }
  }

  async exists(topicId: string): Promise<boolean> {
    const rows = await this.db.query<IdRow>(
      "MATCH (t:Topic) WHERE t.id = $id RETURN t.id AS id LIMIT 1",
      { id: topicId },
    );
    return rows.length > 0;
  }

  async getTopicPath(topicId: string): Promise<string[]> {
    const titles: string[] = [];
    let currentId: string | null = topicId;
    const visited = new Set<string>();
    while (currentId !== null) {
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const rows = await this.db.query<TitleRow>(
        "MATCH (t:Topic) WHERE t.id = $id RETURN t.title AS title LIMIT 1",
        { id: currentId },
      );
      if (rows.length === 0) break;
      titles.unshift(rows[0].title);
      currentId = await this.findParentTopicId(currentId);
    }
    return titles;
  }

  async hasSubtopics(topicId: string): Promise<boolean> {
    const rows = await this.db.query<IdRow>(
      "MATCH (p:Topic)-[:TOPIC_HAS_SUBTOPIC]->(:Topic) WHERE p.id = $id RETURN p.id AS id LIMIT 1",
      { id: topicId },
    );
    return rows.length > 0;
  }

  async insertTopicNode(topic: NewTopicInput): Promise<void> {
    await this.db.query(
      "CREATE (t:Topic {id: $id, title: $title, short_summary: $short_summary, long_summary: $long_summary})",
      {
        id: topic.id,
        title: topic.title,
        short_summary: topic.short_summary,
        long_summary: topic.long_summary,
      },
    );
  }

  async linkSubtopic(parentId: string, childId: string): Promise<void> {
    await this.db.query(
      "MATCH (p:Topic), (c:Topic) WHERE p.id = $parentId AND c.id = $childId CREATE (p)-[:TOPIC_HAS_SUBTOPIC]->(c)",
      { parentId, childId },
    );
  }

  async linkToDocumentFragment(topicId: string, fragId: string): Promise<void> {
    if (await this.edgeExists("TOPIC_HAS_DOCUMENT_FRAGMENT", topicId, "DocumentFragment", fragId)) {
      return;
    }
    await this.db.query(
      "MATCH (t:Topic), (f:DocumentFragment) WHERE t.id = $topicId AND f.id = $fragId CREATE (t)-[:TOPIC_HAS_DOCUMENT_FRAGMENT]->(f)",
      { topicId, fragId },
    );
  }

  async linkToIdeaUnit(topicId: string, iuId: string): Promise<void> {
    if (await this.edgeExists("TOPIC_HAS_IDEA_UNIT", topicId, "IdeaUnit", iuId)) {
      return;
    }
    await this.db.query(
      "MATCH (t:Topic), (u:IdeaUnit) WHERE t.id = $topicId AND u.id = $iuId CREATE (t)-[:TOPIC_HAS_IDEA_UNIT]->(u)",
      { topicId, iuId },
    );
  }

  async listAllTopicsWithParents(): Promise<TopicWithParent[]> {
    const RowSchema = z.object({
      id: z.string(),
      title: z.string(),
      short_summary: z.string(),
      long_summary: z.string(),
      parent_id: z.string().nullable(),
    });
    const rawRows = await this.db.query<unknown>(
      "MATCH (t:Topic) " +
        "OPTIONAL MATCH (p:Topic)-[:TOPIC_HAS_SUBTOPIC]->(t) " +
        "RETURN t.id AS id, t.title AS title, t.short_summary AS short_summary, t.long_summary AS long_summary, p.id AS parent_id " +
        "ORDER BY t.title",
    );
    return z.array(RowSchema).parse(rawRows);
  }

  async listRootTopics(): Promise<TopicOverview[]> {
    const rows = await this.queryRootTopicRows();
    return this.enrichTopics(rows);
  }

  async listSubtopics(parentId: string): Promise<TopicOverview[]> {
    const rows = await this.querySubtopicRows(parentId);
    return this.enrichTopics(rows);
  }

  async listTopicsForSources(
    conversationIds: string[],
    documentIds: string[],
  ): Promise<TopicSummaryRow[]> {
    const ids = new Set<string>();
    if (conversationIds.length > 0) {
      const rawRows = await this.db.query<TopicRow>(
        "MATCH (t:Topic)-[:TOPIC_HAS_IDEA_UNIT]->(u:IdeaUnit) " +
          "WHERE u.conversation_id IN $ids " +
          "RETURN DISTINCT t.id AS id, t.title AS title, t.short_summary AS short_summary, t.long_summary AS long_summary",
        { ids: conversationIds },
      );
      for (const row of z.array(TopicRowSchema).parse(rawRows)) {
        ids.add(JSON.stringify(row));
      }
    }
    if (documentIds.length > 0) {
      const rawRows = await this.db.query<TopicRow>(
        "MATCH (t:Topic)-[:TOPIC_HAS_DOCUMENT_FRAGMENT]->(f:DocumentFragment) " +
          "WHERE f.document_id IN $ids " +
          "RETURN DISTINCT t.id AS id, t.title AS title, t.short_summary AS short_summary, t.long_summary AS long_summary",
        { ids: documentIds },
      );
      for (const row of z.array(TopicRowSchema).parse(rawRows)) {
        ids.add(JSON.stringify(row));
      }
    }
    const merged: TopicSummaryRow[] = Array.from(ids).map((s) =>
      JSON.parse(s) as TopicSummaryRow,
    );
    merged.sort((a, b) => a.title.localeCompare(b.title));
    return merged;
  }

  async listIdeaUnitItemsForTopic(
    topicId: string,
    since: string | null,
  ): Promise<TopicIdeaUnitItem[]> {
    const RowSchema = z.object({
      conversation_id: z.string(),
      conversation_main_topic: z.string(),
      conversation_time: z.string(),
      turn_index: z.union([z.number(), z.bigint()]),
      idea_unit_index: z.union([z.number(), z.bigint()]),
      speaker: z.string(),
      time: z.string(),
      sentences: z.array(z.string()),
      categories: z.array(z.string()),
    });
    const baseMatch =
      "MATCH (t:Topic)-[:TOPIC_HAS_IDEA_UNIT]->(u:IdeaUnit)<-[:TURN_HAS_IDEA_UNIT]-(turn:Turn)<-[:CONVERSATION_HAS_TURN]-(c:Conversation) " +
      "WHERE t.id = $topicId AND u.categories <> ['Irrelevant']";
    const dateFilter = since === null ? "" : " AND c.time > $since";
    const rawRows = await this.db.query<unknown>(
      `${baseMatch}${dateFilter} ` +
        "RETURN c.id AS conversation_id, c.main_topic AS conversation_main_topic, c.time AS conversation_time, " +
        "u.turn_index AS turn_index, u.idea_unit_index AS idea_unit_index, " +
        "turn.speaker AS speaker, turn.time AS time, " +
        "u.sentences AS sentences, u.categories AS categories " +
        "ORDER BY c.time DESC, u.turn_index, u.idea_unit_index",
      since === null ? { topicId } : { topicId, since },
    );
    return z.array(RowSchema).parse(rawRows).map((r) => ({
      type: "idea_unit",
      conversation_id: r.conversation_id,
      conversation_main_topic: r.conversation_main_topic,
      conversation_time: r.conversation_time,
      turn_index: Number(r.turn_index),
      idea_unit_index: Number(r.idea_unit_index),
      speaker: r.speaker,
      time: r.time,
      sentences: r.sentences,
      categories: r.categories,
    }));
  }

  async listDocumentFragmentItemsForTopic(
    topicId: string,
    since: string | null,
  ): Promise<TopicDocumentFragmentItem[]> {
    const RowSchema = z.object({
      document_id: z.string(),
      document_title: z.string(),
      document_date: z.string(),
      document_content: z.string(),
      start_offset: z.union([z.number(), z.bigint()]),
      end_offset: z.union([z.number(), z.bigint()]),
    });
    const baseMatch =
      "MATCH (t:Topic)-[:TOPIC_HAS_DOCUMENT_FRAGMENT]->(f:DocumentFragment)<-[:DOCUMENT_HAS_FRAGMENT]-(d:Document) " +
      "WHERE t.id = $topicId";
    const dateFilter = since === null ? "" : " AND d.date > $since";
    const rawRows = await this.db.query<unknown>(
      `${baseMatch}${dateFilter} ` +
        "RETURN d.id AS document_id, d.title AS document_title, d.date AS document_date, d.content AS document_content, " +
        "f.start_offset AS start_offset, f.end_offset AS end_offset " +
        "ORDER BY d.date DESC, f.start_offset",
      since === null ? { topicId } : { topicId, since },
    );
    return z.array(RowSchema).parse(rawRows).map((r) => {
      const start = Number(r.start_offset);
      const end = Number(r.end_offset);
      return {
        type: "document_fragment" as const,
        document_id: r.document_id,
        document_title: r.document_title,
        document_date: r.document_date,
        start_offset: start,
        end_offset: end,
        text: r.document_content.slice(start, end).trim(),
      };
    });
  }

  async readTopic(topicId: string): Promise<TopicDetail | null> {
    const rawRows = await this.db.query<TopicRow>(
      "MATCH (t:Topic) WHERE t.id = $id RETURN t.id AS id, t.title AS title, t.short_summary AS short_summary, t.long_summary AS long_summary LIMIT 1",
      { id: topicId },
    );
    if (rawRows.length === 0) return null;
    const row = TopicRowSchema.parse(rawRows[0]);
    const path = await this.getTopicPath(topicId);
    return {
      id: row.id,
      title: row.title,
      short_summary: row.short_summary,
      long_summary: row.long_summary,
      path,
    };
  }

  async require(topicId: string): Promise<void> {
    if (!(await this.exists(topicId))) {
      throw new Error(`Topic not found: ${topicId}`);
    }
  }

  async updateTopicFields(
    topicId: string,
    fields: { title: string; short_summary: string; long_summary: string },
  ): Promise<void> {
    await this.db.query(
      "MATCH (t:Topic) WHERE t.id = $id SET t.title = $title, t.short_summary = $short_summary, t.long_summary = $long_summary",
      {
        id: topicId,
        title: fields.title,
        short_summary: fields.short_summary,
        long_summary: fields.long_summary,
      },
    );
  }

  async updateTopicPartialFields(
    topicId: string,
    fields: Partial<{ title: string; short_summary: string; long_summary: string }>,
  ): Promise<void> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const setClause = keys.map((k) => `t.${k} = $${k}`).join(", ");
    await this.db.query(
      `MATCH (t:Topic) WHERE t.id = $id SET ${setClause}`,
      { id: topicId, ...fields },
    );
  }

  private async edgeExists(
    relName: string,
    fromId: string,
    toLabel: string,
    toId: string,
  ): Promise<boolean> {
    const rows = await this.db.query<IdRow>(
      `MATCH (a:Topic)-[:${relName}]->(b:${toLabel}) WHERE a.id = $fromId AND b.id = $toId RETURN a.id AS id LIMIT 1`,
      { fromId, toId },
    );
    return rows.length > 0;
  }

  private async enrichTopics(rows: TopicRow[]): Promise<TopicOverview[]> {
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

  private async findParentTopicId(topicId: string): Promise<string | null> {
    const rows = await this.db.query<IdRow>(
      "MATCH (p:Topic)-[:TOPIC_HAS_SUBTOPIC]->(c:Topic) WHERE c.id = $id RETURN p.id AS id LIMIT 1",
      { id: topicId },
    );
    return rows.length === 0 ? null : rows[0].id;
  }

  private async queryRootTopicRows(): Promise<TopicRow[]> {
    const rawRows = await this.db.query<TopicRow>(
      "MATCH (t:Topic) WHERE NOT EXISTS { MATCH (:Topic)-[:TOPIC_HAS_SUBTOPIC]->(t) } " +
        "RETURN t.id AS id, t.title AS title, t.short_summary AS short_summary, t.long_summary AS long_summary " +
        "ORDER BY t.title",
    );
    return z.array(TopicRowSchema).parse(rawRows);
  }

  private async querySubtopicRows(parentId: string): Promise<TopicRow[]> {
    const rawRows = await this.db.query<TopicRow>(
      "MATCH (p:Topic)-[:TOPIC_HAS_SUBTOPIC]->(t:Topic) WHERE p.id = $parentId " +
        "RETURN t.id AS id, t.title AS title, t.short_summary AS short_summary, t.long_summary AS long_summary " +
        "ORDER BY t.title",
      { parentId },
    );
    return z.array(TopicRowSchema).parse(rawRows);
  }
}
