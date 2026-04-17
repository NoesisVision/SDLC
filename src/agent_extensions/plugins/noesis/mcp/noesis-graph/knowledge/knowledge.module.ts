import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { KnowledgeRepository } from "./knowledge.repository.js";
import { KnowledgeService } from "./knowledge.service.js";

@Module({
  imports: [DatabaseModule],
  providers: [KnowledgeService, KnowledgeRepository],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
