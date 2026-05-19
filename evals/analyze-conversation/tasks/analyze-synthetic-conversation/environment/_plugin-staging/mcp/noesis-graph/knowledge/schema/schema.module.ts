import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { SchemaExplorerController } from "./schema.controller.js";
import { SchemaService } from "./schema.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [SchemaExplorerController],
  providers: [SchemaService],
  exports: [SchemaService],
})
export class SchemaModule {}
