import { Controller, Get, Post, Query } from "@nestjs/common";
import { ScannerService } from "./scanner.service.js";
import { InvocationsService } from "./invocations/invocations.service.js";
import type { DomainModelTree } from "./domain-model/domain-model.js";
import type { Invocation } from "./invocations/invocation-graph.js";

@Controller("api/model")
export class ScannerController {
  constructor(
    private readonly scanner: ScannerService,
    private readonly invocations: InvocationsService,
  ) {}

  @Get()
  async getModel(): Promise<DomainModelTree> {
    return this.scanner.getDomainModel();
  }

  @Get("invocations")
  async getInvocations(
    @Query("sourceBehaviorId") sourceBehaviorId?: string,
    @Query("destinationBehaviorId") destinationBehaviorId?: string,
  ): Promise<Invocation[]> {
    return this.invocations.getBehaviorInvocations({
      sourceBehaviorId,
      destinationBehaviorId,
    });
  }

  @Post("scan")
  async scan(): Promise<DomainModelTree> {
    return this.scanner.scan();
  }
}
