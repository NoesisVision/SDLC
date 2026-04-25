import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { SchemaService } from "./schema.service.js";

@Module({
  imports: [DatabaseModule],
  providers: [SchemaService],
  exports: [SchemaService],
})
export class SchemaModule {}
