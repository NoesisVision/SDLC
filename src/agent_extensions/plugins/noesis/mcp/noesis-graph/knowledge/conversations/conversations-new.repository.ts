import { Injectable } from "@nestjs/common";
import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { z } from "zod";
import type { Turn } from "../../../../shared-contracts/conversation.js";
import {
  ConversationFileNewSchema,
  type ConversationFileNew,
} from "../../../../shared-contracts/source-file-schemas-new.js";
import {
  computeFileSha,
  conversationJsonPath,
  conversationMdPath,
  readSidecar,
  writeSidecar,
} from "../../../../shared-contracts/source-files.js";
import { DatabaseService } from "../../database/database.service.js";

const SCHEMA_STATEMENTS = [
  "CREATE NODE TABLE IF NOT EXISTS Conversation(" +
    "id STRING, sha STRING, time STRING, main_topic STRING, " +
    "PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS Turn(" +
    "id STRING, conversation_id STRING, turn_index INT64, speaker STRING, time STRING, " +
    "PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS IdeaUnit(" +
    "id STRING, conversation_id STRING, turn_index INT64, idea_unit_index INT64, " +
    "sentences STRING[], categories STRING[], " +
    "PRIMARY KEY(id))",
  "CREATE REL TABLE IF NOT EXISTS CONVERSATION_HAS_TURN(FROM Conversation TO Turn)",
  "CREATE REL TABLE IF NOT EXISTS TURN_HAS_IDEA_UNIT(FROM Turn TO IdeaUnit)",
];

const PathRowSchema = z.object({ id: z.string(), sha: z.string() });
const StoredConversationRowSchema = z.object({
  id: z.string(),
  sha: z.string(),
  time: z.string(),
  main_topic: z.string(),
});

export interface StoredConversation {
  id: string;
  sha: string;
  time: string;
  main_topic: string;
}

@Injectable()
export class ConversationsRepositoryNew {
  constructor(private readonly db: DatabaseService) {}

  canonicalJsonPath(projectDir: string, conversationId: string): string {
    return conversationJsonPath(projectDir, conversationId);
  }

  canonicalMdPath(projectDir: string, conversationId: string): string {
    return conversationMdPath(projectDir, conversationId);
  }

  async delete(conversationId: string): Promise<void> {
    await this.deleteTurns(conversationId);
    await this.db.query(
      "MATCH (c:Conversation) WHERE c.id = $id DETACH DELETE c",
      { id: conversationId },
    );
  }

  async exists(conversationId: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      "MATCH (c:Conversation) WHERE c.id = $id RETURN c.id AS id LIMIT 1",
      { id: conversationId },
    );
    return rows.length > 0;
  }

  fileSha(absPath: string): string {
    return computeFileSha(absPath);
  }

  async initSchema(): Promise<void> {
    for (const statement of SCHEMA_STATEMENTS) {
      await this.db.query(statement);
    }
  }

  async listAll(): Promise<StoredConversation[]> {
    const rows = await this.db.query<unknown>(
      "MATCH (c:Conversation) RETURN " +
        "c.id AS id, c.sha AS sha, c.time AS time, c.main_topic AS main_topic " +
        "ORDER BY c.id",
    );
    return z.array(StoredConversationRowSchema).parse(rows);
  }

  async listAllStoredFiles(
    projectDir: string,
  ): Promise<Array<{ id: string; path: string; sha: string }>> {
    const rows = await this.db.query<unknown>(
      "MATCH (c:Conversation) RETURN c.id AS id, c.sha AS sha",
    );
    return z.array(PathRowSchema).parse(rows).map((r) => ({
      id: r.id,
      sha: r.sha,
      path: conversationJsonPath(projectDir, r.id),
    }));
  }

  async read(conversationId: string): Promise<StoredConversation | null> {
    const rows = await this.db.query<unknown>(
      "MATCH (c:Conversation) WHERE c.id = $id RETURN " +
        "c.id AS id, c.sha AS sha, c.time AS time, c.main_topic AS main_topic LIMIT 1",
      { id: conversationId },
    );
    if (rows.length === 0) return null;
    return StoredConversationRowSchema.parse(rows[0]);
  }

  readJsonFile(absPath: string): ConversationFileNew {
    return readSidecar(absPath, ConversationFileNewSchema);
  }

  async upsert(file: ConversationFileNew, sha: string): Promise<void> {
    await this.db.query(
      "MERGE (c:Conversation {id: $id}) SET " +
        "c.sha = $sha, c.time = $time, c.main_topic = $main_topic",
      {
        id: file.conversation_id,
        sha,
        time: file.time,
        main_topic: file.main_topic,
      },
    );
    await this.replaceTurns(file.conversation_id, file.turns);
  }

  writeCleanedMd(absPath: string, content: string): void {
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content, "utf-8");
  }

  writeJsonFile(absPath: string, file: ConversationFileNew): void {
    writeSidecar(absPath, file, ConversationFileNewSchema);
  }

  private async replaceTurns(
    conversationId: string,
    turns: Turn[],
  ): Promise<void> {
    await this.deleteTurns(conversationId);
    for (const turn of turns) {
      const turnId = `${conversationId}|T${turn.index}`;
      await this.db.query(
        "CREATE (t:Turn {id: $id, conversation_id: $cid, turn_index: $idx, speaker: $speaker, time: $time})",
        {
          id: turnId,
          cid: conversationId,
          idx: turn.index,
          speaker: turn.speaker,
          time: turn.time,
        },
      );
      await this.db.query(
        "MATCH (c:Conversation), (t:Turn) WHERE c.id = $cid AND t.id = $tid CREATE (c)-[:CONVERSATION_HAS_TURN]->(t)",
        { cid: conversationId, tid: turnId },
      );
      for (const iu of turn.idea_units) {
        const iuId = `${conversationId}|T${turn.index}|IU${iu.index}`;
        await this.db.query(
          "CREATE (u:IdeaUnit {id: $id, conversation_id: $cid, turn_index: $tidx, idea_unit_index: $iuidx, sentences: $sentences, categories: $categories})",
          {
            id: iuId,
            cid: conversationId,
            tidx: turn.index,
            iuidx: iu.index,
            sentences: iu.sentences,
            categories: iu.categories,
          },
        );
        await this.db.query(
          "MATCH (t:Turn), (u:IdeaUnit) WHERE t.id = $tid AND u.id = $uid CREATE (t)-[:TURN_HAS_IDEA_UNIT]->(u)",
          { tid: turnId, uid: iuId },
        );
      }
    }
  }

  private async deleteTurns(conversationId: string): Promise<void> {
    await this.db.query(
      "MATCH (u:IdeaUnit) WHERE u.conversation_id = $cid DETACH DELETE u",
      { cid: conversationId },
    );
    await this.db.query(
      "MATCH (t:Turn) WHERE t.conversation_id = $cid DETACH DELETE t",
      { cid: conversationId },
    );
  }
}
