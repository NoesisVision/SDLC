import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { DesignDocsController } from "./design-docs.controller.js";
import { DesignDocsRepository } from "./design-docs.repository.js";
import { DesignDocsService } from "./design-docs.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [DesignDocsController],
  providers: [DesignDocsService, DesignDocsRepository],
  exports: [DesignDocsService, DesignDocsRepository],
})
export class DesignDocsModule {}
