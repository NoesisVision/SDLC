import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { DesignDocsRepository } from "./design-docs.repository.js";
import { DesignDocsService } from "./design-docs.service.js";

@Module({
  imports: [DatabaseModule],
  providers: [DesignDocsService, DesignDocsRepository],
  exports: [DesignDocsService],
})
export class DesignDocsModule {}
