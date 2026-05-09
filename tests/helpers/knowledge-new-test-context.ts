import { Test, type TestingModule } from "@nestjs/testing";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  DATA_DIR,
  PROJECT_DIR,
} from "@noesis/mcp/noesis-graph/config/config.module.js";
import { DatabaseService } from "@noesis/mcp/noesis-graph/database/database.service.js";
import { ConversationsRepositoryNew } from "@noesis/mcp/noesis-graph/knowledge/conversations/conversations-new.repository.js";
import { ConversationsServiceNew } from "@noesis/mcp/noesis-graph/knowledge/conversations/conversations-new.service.js";
import { DecisionsRepositoryNew } from "@noesis/mcp/noesis-graph/knowledge/decisions/decisions-new.repository.js";
import { DecisionsServiceNew } from "@noesis/mcp/noesis-graph/knowledge/decisions/decisions-new.service.js";
import { DesignDocsRepositoryNew } from "@noesis/mcp/noesis-graph/knowledge/design-docs/design-docs-new.repository.js";
import { DesignDocsServiceNew } from "@noesis/mcp/noesis-graph/knowledge/design-docs/design-docs-new.service.js";
import { DocumentsRepositoryNew } from "@noesis/mcp/noesis-graph/knowledge/documents/documents-new.repository.js";
import { DocumentsServiceNew } from "@noesis/mcp/noesis-graph/knowledge/documents/documents-new.service.js";
import { TopicsRepositoryNew } from "@noesis/mcp/noesis-graph/knowledge/topics/topics-new.repository.js";
import { TopicsServiceNew } from "@noesis/mcp/noesis-graph/knowledge/topics/topics-new.service.js";
import { IndexerServiceNew } from "@noesis/mcp/noesis-graph/indexer/indexer-new.service.js";

export interface KnowledgeNewTestContext {
  module: TestingModule;
  db: DatabaseService;
  projectDir: string;
  topics: TopicsServiceNew;
  topicsRepository: TopicsRepositoryNew;
  decisions: DecisionsServiceNew;
  decisionsRepository: DecisionsRepositoryNew;
  conversations: ConversationsServiceNew;
  conversationsRepository: ConversationsRepositoryNew;
  documents: DocumentsServiceNew;
  documentsRepository: DocumentsRepositoryNew;
  designDocs: DesignDocsServiceNew;
  designDocsRepository: DesignDocsRepositoryNew;
  indexer: IndexerServiceNew;
}

export async function createKnowledgeNewTestModule(): Promise<KnowledgeNewTestContext> {
  const projectDir = mkdtempSync(join(tmpdir(), "noesis-kg-new-"));
  const module = await Test.createTestingModule({
    providers: [
      DatabaseService,
      TopicsRepositoryNew,
      TopicsServiceNew,
      DecisionsRepositoryNew,
      DecisionsServiceNew,
      ConversationsRepositoryNew,
      ConversationsServiceNew,
      DocumentsRepositoryNew,
      DocumentsServiceNew,
      DesignDocsRepositoryNew,
      DesignDocsServiceNew,
      IndexerServiceNew,
      { provide: DATA_DIR, useValue: projectDir },
      { provide: PROJECT_DIR, useValue: projectDir },
    ],
  }).compile();
  await module.init();
  await module.get(TopicsRepositoryNew).initSchema();
  await module.get(DecisionsRepositoryNew).initSchema();
  await module.get(ConversationsRepositoryNew).initSchema();
  await module.get(DocumentsRepositoryNew).initSchema();
  await module.get(DesignDocsRepositoryNew).initSchema();
  return {
    module,
    db: module.get(DatabaseService),
    projectDir,
    topics: module.get(TopicsServiceNew),
    topicsRepository: module.get(TopicsRepositoryNew),
    decisions: module.get(DecisionsServiceNew),
    decisionsRepository: module.get(DecisionsRepositoryNew),
    conversations: module.get(ConversationsServiceNew),
    conversationsRepository: module.get(ConversationsRepositoryNew),
    documents: module.get(DocumentsServiceNew),
    documentsRepository: module.get(DocumentsRepositoryNew),
    designDocs: module.get(DesignDocsServiceNew),
    designDocsRepository: module.get(DesignDocsRepositoryNew),
    indexer: module.get(IndexerServiceNew),
  };
}

export async function clearGraphNew(db: DatabaseService): Promise<void> {
  const labels = [
    "Conversation",
    "Turn",
    "IdeaUnit",
    "Document",
    "DocumentFragment",
    "Topic",
    "Decision",
    "DesignDoc",
    "Actor",
  ];
  const conn = db.getConnection();
  for (const label of labels) {
    await conn.query(`MATCH (n:${label}) DETACH DELETE n`);
  }
}
