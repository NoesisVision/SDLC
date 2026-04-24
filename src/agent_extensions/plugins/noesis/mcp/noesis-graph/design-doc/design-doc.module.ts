import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { DesignDocRepository } from "./design-doc.repository.js";
import { DesignDocService } from "./design-doc.service.js";

@Module({
  imports: [DatabaseModule],
  providers: [DesignDocService, DesignDocRepository],
  exports: [DesignDocService],
})
export class DesignDocModule {}
