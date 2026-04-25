import { Controller, Get, Query } from "@nestjs/common";
import { InvocationGraphService } from "./invocation-graph.service.js";
import type { InvocationGraphData } from "./invocation-graph-data.js";

@Controller("api/ui/invocation-graph")
export class InvocationGraphController {
  constructor(private readonly service: InvocationGraphService) {}

  @Get()
  async get(
    @Query("behaviorId") behaviorId: string,
  ): Promise<InvocationGraphData> {
    return this.service.getInvocationGraph(behaviorId);
  }
}
