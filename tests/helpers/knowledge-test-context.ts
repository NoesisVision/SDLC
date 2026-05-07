import { Test, type TestingModule } from "@nestjs/testing";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { DATA_DIR, PROJECT_DIR } from "@noesis/mcp/noesis-graph/config/config.module.js";
import { DatabaseService } from "@noesis/mcp/noesis-graph/database/database.service.js";
import { FileSyncService } from "@noesis/mcp/noesis-graph/file-sync/file-sync.service.js";
import { GraphProjectionService } from "@noesis/mcp/noesis-graph/file-sync/graph-projection.service.js";
import { SourceFilesRepository } from "@noesis/mcp/noesis-graph/file-sync/source-files.repository.js";
import { StalenessService } from "@noesis/mcp/noesis-graph/file-sync/staleness.service.js";
import { ConversationsRepository } from "@noesis/mcp/noesis-graph/knowledge/conversations/conversations.repository.js";
import { ConversationsService } from "@noesis/mcp/noesis-graph/knowledge/conversations/conversations.service.js";
import { DecisionsRepository } from "@noesis/mcp/noesis-graph/knowledge/decisions/decisions.repository.js";
import { DecisionsService } from "@noesis/mcp/noesis-graph/knowledge/decisions/decisions.service.js";
import { DesignDocsRepository } from "@noesis/mcp/noesis-graph/knowledge/design-docs/design-docs.repository.js";
import { DocumentsRepository } from "@noesis/mcp/noesis-graph/knowledge/documents/documents.repository.js";
import { DocumentsService } from "@noesis/mcp/noesis-graph/knowledge/documents/documents.service.js";
import { SchemaService } from "@noesis/mcp/noesis-graph/knowledge/schema/schema.service.js";
import { TopicsRepository } from "@noesis/mcp/noesis-graph/knowledge/topics/topics.repository.js";
import { TopicsService } from "@noesis/mcp/noesis-graph/knowledge/topics/topics.service.js";

const NODE_LABELS = [
  "AlternativeOption",
  "Decision",
  "Topic",
  "IdeaUnit",
  "Turn",
  "Conversation",
  "DocumentFragment",
  "Document",
  "SourceFile",
];

export interface KnowledgeTestContext {
  module: TestingModule;
  db: DatabaseService;
  tmpDir: string;
}

export async function createKnowledgeTestModule(): Promise<KnowledgeTestContext> {
  const tmpDir = mkdtempSync(join(tmpdir(), "noesis-kg-test-"));
  const module = await Test.createTestingModule({
    providers: [
      DatabaseService,
      SchemaService,
      TopicsService,
      TopicsRepository,
      ConversationsService,
      ConversationsRepository,
      DocumentsService,
      DocumentsRepository,
      DecisionsService,
      DecisionsRepository,
      DesignDocsRepository,
      SourceFilesRepository,
      FileSyncService,
      GraphProjectionService,
      StalenessService,
      { provide: DATA_DIR, useValue: tmpDir },
      { provide: PROJECT_DIR, useValue: tmpDir },
    ],
  }).compile();
  await module.init();
  await module.get(DesignDocsRepository).initSchema();
  return { module, db: module.get(DatabaseService), tmpDir };
}

export async function clearGraph(db: DatabaseService): Promise<void> {
  const conn = db.getConnection();
  for (const label of NODE_LABELS) {
    await conn.query(`MATCH (n:${label}) DETACH DELETE n`);
  }
}

export async function countNodes(
  db: DatabaseService,
  label: string,
): Promise<number> {
  const result = await db
    .getConnection()
    .query(`MATCH (n:${label}) RETURN COUNT(n) AS c`);
  const rows = asArray(result).getAllSync() as Array<{ c: number | bigint }>;
  return Number(rows[0].c);
}

export async function countRels(
  db: DatabaseService,
  relName: string,
): Promise<number> {
  const result = await db
    .getConnection()
    .query(`MATCH ()-[r:${relName}]->() RETURN COUNT(r) AS c`);
  const rows = asArray(result).getAllSync() as Array<{ c: number | bigint }>;
  return Number(rows[0].c);
}

export function asArray(
  result: unknown,
): { getNumTuples(): number; getAllSync(): unknown[] } {
  if (Array.isArray(result)) return result[0];
  return result as { getNumTuples(): number; getAllSync(): unknown[] };
}

export function sampleConversation(id: string): unknown {
  return {
    conversation_id: id,
    time: "2026-04-17T10:00:00Z",
    main_topic: "Sample",
    turns: [
      {
        index: 0,
        speaker: "alice",
        time: "2026-04-17T10:00:00Z",
        idea_units: [
          { index: 0, sentences: ["hello"], categories: ["Information"] },
          { index: 1, sentences: ["world"], categories: ["Position"] },
        ],
      },
      {
        index: 1,
        speaker: "bob",
        time: "2026-04-17T10:01:00Z",
        idea_units: [
          { index: 0, sentences: ["ok"], categories: ["Argument"] },
        ],
      },
    ],
    topics: [],
    decisions: [],
  };
}
