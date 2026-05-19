import { Controller, Get, Query } from "@nestjs/common";
import type { InvocationGraphData } from "../../ui-contracts/invocation-graph/invocation-graph-data.js";
import { InvocationsService } from "./invocations.service.js";

@Controller("api/ui/invocation-graph")
export class InvocationGraphController {
  constructor(private readonly invocations: InvocationsService) {}

  @Get()
  async get(
    @Query("behaviorId") behaviorId: string,
  ): Promise<InvocationGraphData> {
    return this.invocations.getInvocationGraph(behaviorId);
  }
}
