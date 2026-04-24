import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { DesignDocModule } from "../design-doc/design-doc.module.js";
import { KnowledgeRepository } from "./knowledge.repository.js";
import { KnowledgeService } from "./knowledge.service.js";

@Module({
  imports: [DatabaseModule, DesignDocModule],
  providers: [KnowledgeService, KnowledgeRepository],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
