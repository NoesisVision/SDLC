import { Controller, Get } from "@nestjs/common";
import type { GraphSchemaData } from "../../ui-contracts/graph-schema/graph-schema-data.js";
import { SchemaService } from "./schema.service.js";

@Controller("api/ui/graph-schema")
export class GraphSchemaController {
  constructor(private readonly schema: SchemaService) {}

  @Get()
  async get(): Promise<GraphSchemaData> {
    return this.schema.getSchema();
  }
}
