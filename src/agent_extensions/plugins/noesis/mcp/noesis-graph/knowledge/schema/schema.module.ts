import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { GraphSchemaController } from "./schema.controller.js";
import { SchemaService } from "./schema.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [GraphSchemaController],
  providers: [SchemaService],
  exports: [SchemaService],
})
export class SchemaModule {}
