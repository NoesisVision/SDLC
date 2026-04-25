import { Controller, Get } from "@nestjs/common";
import { SchemaService } from "../../knowledge/schema/schema.service.js";
import type { GraphSchemaData } from "./graph-schema-data.js";

@Controller("api/ui/graph-schema")
export class GraphSchemaController {
  constructor(private readonly schema: SchemaService) {}

  @Get()
  async get(): Promise<GraphSchemaData> {
    return this.schema.getSchema();
  }
}
