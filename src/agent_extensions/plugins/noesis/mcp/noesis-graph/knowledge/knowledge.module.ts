import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { IndexerModule } from "../indexer/indexer.module.js";
import { ConversationsRepository } from "./conversations/conversations.repository.js";
import { ConversationsService } from "./conversations/conversations.service.js";
import { DecisionsController } from "./decisions/decisions.controller.js";
import { DecisionsRepository } from "./decisions/decisions.repository.js";
import { DecisionsService } from "./decisions/decisions.service.js";
import { DesignDocsModule } from "./design-docs/design-docs.module.js";
import { DocumentsRepository } from "./documents/documents.repository.js";
import { DocumentsService } from "./documents/documents.service.js";
import { SchemaModule } from "./schema/schema.module.js";
import { TopicsController } from "./topics/topics.controller.js";
import { TopicsRepository } from "./topics/topics.repository.js";
import { TopicsService } from "./topics/topics.service.js";

@Module({
  imports: [DatabaseModule, SchemaModule, DesignDocsModule, IndexerModule],
  controllers: [TopicsController, DecisionsController],
  providers: [
    TopicsService,
    TopicsRepository,
    DecisionsService,
    DecisionsRepository,
    ConversationsService,
    ConversationsRepository,
    DocumentsService,
    DocumentsRepository,
  ],
  exports: [
    TopicsService,
    DecisionsService,
    ConversationsService,
    DocumentsService,
    SchemaModule,
    DesignDocsModule,
  ],
})
export class KnowledgeModule {}
