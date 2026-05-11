import { Injectable } from "@nestjs/common";
import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { z } from "zod";
import type { Turn } from "../../../../shared-contracts/conversation.js";
import {
  ConversationFileNewSchema,
  type ConversationFileNew,
} from "../../../../shared-contracts/source-file-schemas.js";
import {
  computeFileSha,
  conversationJsonPath,
  conversationMdPath,
  readSidecar,
  writeSidecar,
} from "../../../../shared-contracts/source-files.js";
import { DatabaseService, type QueryParams } from "../../database/database.service.js";

const SCHEMA_STATEMENTS = [
  "CREATE NODE TABLE IF NOT EXISTS Conversation(" +
    "id STRING, sha STRING, time STRING, main_topic STRING, " +
    "PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS SpeakerTurn(" +
    "id STRING, turn_index INT64, speaker STRING, time STRING, " +
    "PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS IdeaUnit(" +
    "id STRING, idea_unit_index INT64, " +
    "sentences STRING[], categories STRING[], " +
    "PRIMARY KEY(id))",
  "CREATE REL TABLE IF NOT EXISTS CONVERSATION_HAS_SPEAKER_TURN(FROM Conversation TO SpeakerTurn)",
  "CREATE REL TABLE IF NOT EXISTS SPEAKER_TURN_HAS_IDEA_UNIT(FROM SpeakerTurn TO IdeaUnit)",
];

const PathRowSchema = z.object({ id: z.string(), sha: z.string() });
const StoredConversationRowSchema = z.object({
  id: z.string(),
  sha: z.string(),
  time: z.string(),
  main_topic: z.string(),
});

const IdeaUnitDetailRowSchema = z.object({
  conversation_id: z.string(),
  turn_index: z.union([z.number(), z.bigint()]),
  idea_unit_index: z.union([z.number(), z.bigint()]),
  speaker: z.string(),
  time: z.string(),
  sentences: z.array(z.string()),
  categories: z.array(z.string()),
});

export interface StoredConversation {
  id: string;
  sha: string;
  time: string;
  main_topic: string;
}

export interface IdeaUnitDetailRow {
  conversation_id: string;
  turn_index: number;
  idea_unit_index: number;
  speaker: string;
  time: string;
  sentences: string[];
  categories: string[];
}

export interface IdeaUnitPosition {
  turn_index: number;
  idea_unit_index: number;
}

@Injectable()
export class ConversationsRepository {
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
    return this.queryHeads(
      "MATCH (c:Conversation) RETURN " +
        "c.id AS id, c.sha AS sha, c.time AS time, c.main_topic AS main_topic " +
        "ORDER BY c.id",
    );
  }

  async listByIds(ids: string[]): Promise<StoredConversation[]> {
    if (ids.length === 0) return [];
    return this.queryHeads(
      "MATCH (c:Conversation) WHERE c.id IN $ids RETURN " +
        "c.id AS id, c.sha AS sha, c.time AS time, c.main_topic AS main_topic " +
        "ORDER BY c.time",
      { ids },
    );
  }

  async listIdeaUnitDetails(
    conversationId: string,
    positions: IdeaUnitPosition[],
  ): Promise<IdeaUnitDetailRow[]> {
    if (positions.length === 0) return [];
    const ids = positions.map(
      (p) => `${conversationId}|T${p.turn_index}|IU${p.idea_unit_index}`,
    );
    const rows = await this.db.query<unknown>(
      "MATCH (c:Conversation)-[:CONVERSATION_HAS_SPEAKER_TURN]->(t:SpeakerTurn)-[:SPEAKER_TURN_HAS_IDEA_UNIT]->(u:IdeaUnit) " +
        "WHERE u.id IN $ids " +
        "RETURN c.id AS conversation_id, t.turn_index AS turn_index, " +
        "u.idea_unit_index AS idea_unit_index, t.speaker AS speaker, t.time AS time, " +
        "u.sentences AS sentences, u.categories AS categories " +
        "ORDER BY t.turn_index, u.idea_unit_index",
      { ids },
    );
    return z.array(IdeaUnitDetailRowSchema).parse(rows).map((r) => ({
      conversation_id: r.conversation_id,
      turn_index: Number(r.turn_index),
      idea_unit_index: Number(r.idea_unit_index),
      speaker: r.speaker,
      time: r.time,
      sentences: r.sentences,
      categories: r.categories,
    }));
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
        "CREATE (t:SpeakerTurn {id: $id, turn_index: $idx, speaker: $speaker, time: $time})",
        {
          id: turnId,
          idx: turn.index,
          speaker: turn.speaker,
          time: turn.time,
        },
      );
      await this.db.query(
        "MATCH (c:Conversation), (t:SpeakerTurn) WHERE c.id = $cid AND t.id = $tid CREATE (c)-[:CONVERSATION_HAS_SPEAKER_TURN]->(t)",
        { cid: conversationId, tid: turnId },
      );
      for (const iu of turn.idea_units) {
        const iuId = `${conversationId}|T${turn.index}|IU${iu.index}`;
        await this.db.query(
          "CREATE (u:IdeaUnit {id: $id, idea_unit_index: $iuidx, sentences: $sentences, categories: $categories})",
          {
            id: iuId,
            iuidx: iu.index,
            sentences: iu.sentences,
            categories: iu.categories,
          },
        );
        await this.db.query(
          "MATCH (t:SpeakerTurn), (u:IdeaUnit) WHERE t.id = $tid AND u.id = $uid CREATE (t)-[:SPEAKER_TURN_HAS_IDEA_UNIT]->(u)",
          { tid: turnId, uid: iuId },
        );
      }
    }
  }

  private async deleteTurns(conversationId: string): Promise<void> {
    await this.db.query(
      "MATCH (c:Conversation)-[:CONVERSATION_HAS_SPEAKER_TURN]->(:SpeakerTurn)-[:SPEAKER_TURN_HAS_IDEA_UNIT]->(u:IdeaUnit) " +
        "WHERE c.id = $cid DETACH DELETE u",
      { cid: conversationId },
    );
    await this.db.query(
      "MATCH (c:Conversation)-[:CONVERSATION_HAS_SPEAKER_TURN]->(t:SpeakerTurn) WHERE c.id = $cid DETACH DELETE t",
      { cid: conversationId },
    );
  }

  private async queryHeads(
    cypher: string,
    params: QueryParams = {},
  ): Promise<StoredConversation[]> {
    const rows = await this.db.query<unknown>(cypher, params);
    return z.array(StoredConversationRowSchema).parse(rows);
  }
}
