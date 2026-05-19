import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { KnowledgeModule } from "../knowledge/knowledge.module.js";
import { IndexStateController } from "./index-state.controller.js";
import { IndexerService } from "./indexer.service.js";

@Module({
  imports: [DatabaseModule, KnowledgeModule],
  controllers: [IndexStateController],
  providers: [IndexerService],
  exports: [IndexerService],
})
export class IndexerModule {}
