import { Controller, Get } from "@nestjs/common";
import type { SchemaExplorerData } from "../../ui-contracts/schema-explorer/schema-explorer-data.js";
import { SchemaService } from "./schema.service.js";

@Controller("api/ui/schema-explorer")
export class SchemaExplorerController {
  constructor(private readonly schema: SchemaService) {}

  @Get()
  async get(): Promise<SchemaExplorerData> {
    return this.schema.getSchema();
  }
}
