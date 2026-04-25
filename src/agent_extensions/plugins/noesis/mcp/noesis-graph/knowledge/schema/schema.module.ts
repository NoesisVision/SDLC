import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { SchemaController } from "./schema.controller.js";
import { SchemaService } from "./schema.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [SchemaController],
  providers: [SchemaService],
  exports: [SchemaService],
})
export class SchemaModule {}
