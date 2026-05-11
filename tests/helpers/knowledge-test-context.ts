import { Test, type TestingModule } from "@nestjs/testing";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  DATA_DIR,
  PROJECT_DIR,
} from "@noesis/mcp/noesis-graph/config/config.module.js";
import { DatabaseService } from "@noesis/mcp/noesis-graph/database/database.service.js";
import { ConversationsRepository } from "@noesis/mcp/noesis-graph/knowledge/conversations/conversations.repository.js";
import { ConversationsService } from "@noesis/mcp/noesis-graph/knowledge/conversations/conversations.service.js";
import { DecisionsRepository } from "@noesis/mcp/noesis-graph/knowledge/decisions/decisions.repository.js";
import { DecisionsService } from "@noesis/mcp/noesis-graph/knowledge/decisions/decisions.service.js";
import { DesignDocsRepository } from "@noesis/mcp/noesis-graph/knowledge/design-docs/design-docs.repository.js";
import { DesignDocsService } from "@noesis/mcp/noesis-graph/knowledge/design-docs/design-docs.service.js";
import { DocumentsRepository } from "@noesis/mcp/noesis-graph/knowledge/documents/documents.repository.js";
import { DocumentsService } from "@noesis/mcp/noesis-graph/knowledge/documents/documents.service.js";
import { TopicsRepository } from "@noesis/mcp/noesis-graph/knowledge/topics/topics.repository.js";
import { TopicsService } from "@noesis/mcp/noesis-graph/knowledge/topics/topics.service.js";
import { IndexerService } from "@noesis/mcp/noesis-graph/indexer/indexer.service.js";

export interface KnowledgeNewTestContext {
  module: TestingModule;
  db: DatabaseService;
  projectDir: string;
  topics: TopicsService;
  topicsRepository: TopicsRepository;
  decisions: DecisionsService;
  decisionsRepository: DecisionsRepository;
  conversations: ConversationsService;
  conversationsRepository: ConversationsRepository;
  documents: DocumentsService;
  documentsRepository: DocumentsRepository;
  designDocs: DesignDocsService;
  designDocsRepository: DesignDocsRepository;
  indexer: IndexerService;
}

export async function createKnowledgeNewTestModule(): Promise<KnowledgeNewTestContext> {
  const projectDir = mkdtempSync(join(tmpdir(), "noesis-kg-new-"));
  const module = await Test.createTestingModule({
    providers: [
      DatabaseService,
      TopicsRepository,
      TopicsService,
      DecisionsRepository,
      DecisionsService,
      ConversationsRepository,
      ConversationsService,
      DocumentsRepository,
      DocumentsService,
      DesignDocsRepository,
      DesignDocsService,
      IndexerService,
      { provide: DATA_DIR, useValue: projectDir },
      { provide: PROJECT_DIR, useValue: projectDir },
    ],
  }).compile();
  await module.init();
  await module.get(ConversationsRepository).initSchema();
  await module.get(DocumentsRepository).initSchema();
  await module.get(TopicsRepository).initSchema();
  await module.get(DecisionsRepository).initSchema();
  await module.get(DesignDocsRepository).initSchema();
  return {
    module,
    db: module.get(DatabaseService),
    projectDir,
    topics: module.get(TopicsService),
    topicsRepository: module.get(TopicsRepository),
    decisions: module.get(DecisionsService),
    decisionsRepository: module.get(DecisionsRepository),
    conversations: module.get(ConversationsService),
    conversationsRepository: module.get(ConversationsRepository),
    documents: module.get(DocumentsService),
    documentsRepository: module.get(DocumentsRepository),
    designDocs: module.get(DesignDocsService),
    designDocsRepository: module.get(DesignDocsRepository),
    indexer: module.get(IndexerService),
  };
}

export async function clearGraphNew(db: DatabaseService): Promise<void> {
  const labels = [
    "Conversation",
    "SpeakerTurn",
    "IdeaUnit",
    "Document",
    "DocumentFragment",
    "Topic",
    "Decision",
    "DecisionContext",
    "DecisionOption",
    "DesignDoc",
    "Actor",
    "DesignedBoundedContext",
    "DesignedDomainModule",
    "DesignedBuildingBlock",
    "DesignedBehaviour",
    "DesignedProperty",
    "DesignedRule",
    "DesignedScenario",
    "DesignedQualityAttribute",
  ];
  const conn = db.getConnection();
  for (const label of labels) {
    await conn.query(`MATCH (n:${label}) DETACH DELETE n`);
  }
}
