import { Controller, Get } from "@nestjs/common";
import { SchemaService, type GraphSchema } from "./schema.service.js";

@Controller("api/knowledge/schema")
export class SchemaController {
  constructor(private readonly schema: SchemaService) {}

  @Get()
  async getSchema(): Promise<GraphSchema> {
    return this.schema.getSchema();
  }
}
