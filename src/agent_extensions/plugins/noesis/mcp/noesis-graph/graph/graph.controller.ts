import { Controller, Get } from "@nestjs/common";
import { GraphService, type GraphSchema } from "./graph.service.js";

@Controller("api/graph")
export class GraphController {
  constructor(private readonly graph: GraphService) {}

  @Get("schema")
  async getSchema(): Promise<GraphSchema> {
    return this.graph.getSchema();
  }
}
