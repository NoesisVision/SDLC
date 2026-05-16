import { Injectable } from "@nestjs/common";
import { existsSync, unlinkSync } from "fs";
import { z } from "zod";
import {
  TopicFileSchema,
  type TopicFile,
} from "../../../../shared-contracts/topic.js";
import {
  computeFileSha,
  findTopicJsonById,
  readSourceFile,
  topicJsonPath,
  writeSourceFile,
} from "../../../../shared-contracts/source-files.js";
import { DatabaseService, type QueryParams } from "../../database/database.service.js";

const SCHEMA_STATEMENTS = [
  "CREATE NODE TABLE IF NOT EXISTS Topic(" +
    "id STRING, sha STRING, " +
    "title STRING, title_locked BOOLEAN DEFAULT false, " +
    "short_summary STRING, short_summary_locked BOOLEAN DEFAULT false, " +
    "long_summary STRING, long_summary_locked BOOLEAN DEFAULT false, " +
    "reviewed BOOLEAN DEFAULT false, decisions_extracted BOOLEAN DEFAULT false, " +
    "is_stale BOOLEAN DEFAULT false, " +
    "PRIMARY KEY(id))",
  "CREATE REL TABLE IF NOT EXISTS TOPIC_HAS_PARENT(FROM Topic TO Topic)",
  "CREATE REL TABLE IF NOT EXISTS IDEA_UNIT_BELONGS_TO_TOPIC(" +
    "FROM IdeaUnit TO Topic, source_sha STRING DEFAULT '')",
  "CREATE REL TABLE IF NOT EXISTS DOCUMENT_FRAGMENT_BELONGS_TO_TOPIC(" +
    "FROM DocumentFragment TO Topic, source_sha STRING DEFAULT '')",
];

const STORED_PROJECTION =
  "t.id AS id, t.sha AS sha, parent.id AS parent_id, " +
  "t.title AS title, t.title_locked AS title_locked, " +
  "t.short_summary AS short_summary, t.short_summary_locked AS short_summary_locked, " +
  "t.long_summary AS long_summary, t.long_summary_locked AS long_summary_locked, " +
  "t.reviewed AS reviewed, t.decisions_extracted AS decisions_extracted, " +
  "t.is_stale AS is_stale";

const TopicFileRowSchema = z.object({
  id: z.string(),
  sha: z.string(),
  parent_id: z.string().nullable(),
  title: z.string(),
  title_locked: z.boolean(),
  short_summary: z.string(),
  short_summary_locked: z.boolean(),
  long_summary: z.string(),
  long_summary_locked: z.boolean(),
  reviewed: z.boolean(),
  decisions_extracted: z.boolean(),
  is_stale: z.boolean(),
});
type TopicFileRow = z.infer<typeof TopicFileRowSchema>;

const PathRowSchema = z.object({
  id: z.string(),
  sha: z.string(),
  title: z.string(),
});

const StaleRowSchema = z.object({ is_stale: z.boolean() });

export interface StoredTopic {
  id: string;
  sha: string;
  parent_id: string | null;
  title: string;
  title_locked: boolean;
  short_summary: string;
  short_summary_locked: boolean;
  long_summary: string;
  long_summary_locked: boolean;
  reviewed: boolean;
  decisions_extracted: boolean;
  is_stale: boolean;
}

@Injectable()
export class TopicsRepository {
  constructor(private readonly db: DatabaseService) {}

  canonicalPath(projectDir: string, topicId: string, title: string): string {
    return topicJsonPath(projectDir, topicId, title);
  }

  async delete(topicId: string): Promise<void> {
    await this.db.query("MATCH (t:Topic) WHERE t.id = $id DETACH DELETE t", {
      id: topicId,
    });
  }

  async exists(topicId: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      "MATCH (t:Topic) WHERE t.id = $id RETURN t.id AS id LIMIT 1",
      { id: topicId },
    );
    return rows.length > 0;
  }

  deleteFile(absPath: string): void {
    if (existsSync(absPath)) unlinkSync(absPath);
  }

  fileExists(absPath: string): boolean {
    return existsSync(absPath);
  }

  fileSha(absPath: string): string {
    return computeFileSha(absPath);
  }

  findFileById(projectDir: string, topicId: string): string | null {
    return findTopicJsonById(projectDir, topicId);
  }

  async initSchema(): Promise<void> {
    for (const stmt of SCHEMA_STATEMENTS) {
      await this.db.query(stmt);
    }
  }

  async listAll(): Promise<StoredTopic[]> {
    return this.queryStored(
      "MATCH (t:Topic) " +
        "OPTIONAL MATCH (t)-[:TOPIC_HAS_PARENT]->(parent:Topic) " +
        "RETURN " + STORED_PROJECTION + " ORDER BY t.title",
    );
  }

  async listChildren(parentId: string | null): Promise<StoredTopic[]> {
    if (parentId === null) {
      return this.queryStored(
        "MATCH (t:Topic) " +
          "WHERE NOT EXISTS { MATCH (t)-[:TOPIC_HAS_PARENT]->(:Topic) } " +
          "OPTIONAL MATCH (t)-[:TOPIC_HAS_PARENT]->(parent:Topic) " +
          `RETURN ${STORED_PROJECTION} ORDER BY t.title`,
      );
    }
    return this.queryStored(
      "MATCH (t:Topic)-[:TOPIC_HAS_PARENT]->(parent:Topic) " +
        "WHERE parent.id = $parentId " +
        `RETURN ${STORED_PROJECTION} ORDER BY t.title`,
      { parentId },
    );
  }

  async listAllStoredFiles(
    projectDir: string,
  ): Promise<Array<{ id: string; path: string; sha: string }>> {
    const rows = await this.db.query<unknown>(
      "MATCH (t:Topic) RETURN t.id AS id, t.sha AS sha, t.title AS title",
    );
    return z.array(PathRowSchema).parse(rows).map((r) => ({
      id: r.id,
      sha: r.sha,
      path: topicJsonPath(projectDir, r.id, r.title),
    }));
  }

  async read(topicId: string): Promise<StoredTopic | null> {
    const rows = await this.queryStored(
      "MATCH (t:Topic) WHERE t.id = $id " +
        "OPTIONAL MATCH (t)-[:TOPIC_HAS_PARENT]->(parent:Topic) " +
        `RETURN ${STORED_PROJECTION} LIMIT 1`,
      { id: topicId },
    );
    return rows[0] ?? null;
  }

  readFile(absPath: string): TopicFile {
    return readSourceFile(absPath, TopicFileSchema);
  }

  async readStaleFlag(topicId: string): Promise<boolean | null> {
    const rows = await this.db.query<unknown>(
      "MATCH (t:Topic) WHERE t.id = $id RETURN t.is_stale AS is_stale LIMIT 1",
      { id: topicId },
    );
    if (rows.length === 0) return null;
    return StaleRowSchema.parse(rows[0]).is_stale;
  }

  async upsert(file: TopicFile, sha: string): Promise<void> {
    await this.db.query(
      "MERGE (t:Topic {id: $id}) SET " +
        "t.sha = $sha, " +
        "t.title = $title, t.title_locked = $title_locked, " +
        "t.short_summary = $short_summary, t.short_summary_locked = $short_summary_locked, " +
        "t.long_summary = $long_summary, t.long_summary_locked = $long_summary_locked, " +
        "t.reviewed = $reviewed, t.decisions_extracted = $decisions_extracted, " +
        "t.is_stale = $is_stale",
      {
        id: file.id,
        sha,
        title: file.title,
        title_locked: file.title_locked,
        short_summary: file.short_summary,
        short_summary_locked: file.short_summary_locked,
        long_summary: file.long_summary,
        long_summary_locked: file.long_summary_locked,
        reviewed: file.reviewed,
        decisions_extracted: file.decisions_extracted,
        is_stale: file.is_stale,
      },
    );
    await this.db.query(
      "MATCH (t:Topic)-[r:TOPIC_HAS_PARENT]->(:Topic) WHERE t.id = $id DELETE r",
      { id: file.id },
    );
    if (file.parent_id !== null) {
      await this.db.query(
        "MATCH (t:Topic), (parent:Topic) WHERE t.id = $id AND parent.id = $parentId " +
          "CREATE (t)-[:TOPIC_HAS_PARENT]->(parent)",
        { id: file.id, parentId: file.parent_id },
      );
    }
    await this.replaceItemRels(file);
  }

  writeFile(absPath: string, file: TopicFile): void {
    writeSourceFile(absPath, file, TopicFileSchema);
  }

  async writeStaleFlag(topicId: string, isStale: boolean): Promise<void> {
    await this.db.query(
      "MATCH (t:Topic) WHERE t.id = $id SET t.is_stale = $is_stale",
      { id: topicId, is_stale: isStale },
    );
  }

  private async replaceItemRels(file: TopicFile): Promise<void> {
    await this.db.query(
      "MATCH (:IdeaUnit)-[r:IDEA_UNIT_BELONGS_TO_TOPIC]->(t:Topic) WHERE t.id = $id DELETE r",
      { id: file.id },
    );
    await this.db.query(
      "MATCH (:DocumentFragment)-[r:DOCUMENT_FRAGMENT_BELONGS_TO_TOPIC]->(t:Topic) WHERE t.id = $id DELETE r",
      { id: file.id },
    );
    for (const item of file.items) {
      const sourceSha = item.source_sha ?? "";
      if (item.type === "idea_unit_ref") {
        const ideaUnitId = `${item.conversation_id}|T${item.turn_index}|IU${item.idea_unit_index}`;
        await this.db.query(
          "MATCH (u:IdeaUnit), (t:Topic) WHERE u.id = $uid AND t.id = $tid " +
            "CREATE (u)-[:IDEA_UNIT_BELONGS_TO_TOPIC {source_sha: $sha}]->(t)",
          { uid: ideaUnitId, tid: file.id, sha: sourceSha },
        );
      } else {
        const fragmentId = `${item.document_id}|F${item.start_offset}-${item.end_offset}`;
        await this.db.query(
          "MATCH (f:DocumentFragment), (t:Topic) WHERE f.id = $fid AND t.id = $tid " +
            "CREATE (f)-[:DOCUMENT_FRAGMENT_BELONGS_TO_TOPIC {source_sha: $sha}]->(t)",
          { fid: fragmentId, tid: file.id, sha: sourceSha },
        );
      }
    }
  }

  private async queryStored(
    cypher: string,
    params: QueryParams = {},
  ): Promise<StoredTopic[]> {
    const rows = await this.db.query<unknown>(cypher, params);
    return z.array(TopicFileRowSchema).parse(rows).map(toStoredTopic);
  }
}

function toStoredTopic(row: TopicFileRow): StoredTopic {
  return {
    id: row.id,
    sha: row.sha,
    parent_id: row.parent_id,
    title: row.title,
    title_locked: row.title_locked,
    short_summary: row.short_summary,
    short_summary_locked: row.short_summary_locked,
    long_summary: row.long_summary,
    long_summary_locked: row.long_summary_locked,
    reviewed: row.reviewed,
    decisions_extracted: row.decisions_extracted,
    is_stale: row.is_stale,
  };
}
