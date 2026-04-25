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

  async listRootTopics(): Promise<TopicOverview[]> {
    const rows = await this.queryRootTopicRows();
    return this.enrichTopics(rows);
  }

  async listSubtopics(parentId: string): Promise<TopicOverview[]> {
    const rows = await this.querySubtopicRows(parentId);
    return this.enrichTopics(rows);
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
