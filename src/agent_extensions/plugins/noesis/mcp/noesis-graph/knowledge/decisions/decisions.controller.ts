import { Controller, Get, Param } from "@nestjs/common";
import type {
  DecisionDetailData,
  DecisionsPageData,
} from "../../ui-contracts/decisions/decisions-data.js";
import { DecisionsService } from "./decisions.service.js";

@Controller("api/ui/decisions")
export class DecisionsController {
  constructor(private readonly decisions: DecisionsService) {}

  @Get()
  async get(): Promise<DecisionsPageData> {
    return this.decisions.getDecisionsPage();
  }

  @Get(":decisionId")
  async getDetail(
    @Param("decisionId") decisionId: string,
  ): Promise<DecisionDetailData> {
    return this.decisions.getDecisionDetail(decisionId);
  }
}
