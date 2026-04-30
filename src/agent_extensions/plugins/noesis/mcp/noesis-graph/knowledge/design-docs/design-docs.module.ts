import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { IndexerModule } from "../../indexer/indexer.module.js";
import { DesignDocsController } from "./design-docs.controller.js";
import { DesignDocsService } from "./design-docs.service.js";

@Module({
  imports: [DatabaseModule, IndexerModule],
  controllers: [DesignDocsController],
  providers: [DesignDocsService],
  exports: [DesignDocsService],
})
export class DesignDocsModule {}
