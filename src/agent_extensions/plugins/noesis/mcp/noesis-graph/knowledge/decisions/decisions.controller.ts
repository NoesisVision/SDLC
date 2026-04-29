import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import type {
  DecisionConversationDetailData,
  DecisionDetailData,
  DecisionDocumentDetailData,
  DecisionsPageData,
} from "../../ui-contracts/decisions/decisions-data.js";
import { DecisionsService } from "./decisions.service.js";

interface DecisionUpdateBody {
  title?: string;
  context_text?: string;
  decision_text?: string;
  decision_rationale?: string;
}

interface AlternativeUpdateBody {
  text?: string;
  rationale?: string;
}

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

  @Patch(":decisionId")
  async update(
    @Param("decisionId") decisionId: string,
    @Body() body: DecisionUpdateBody,
  ): Promise<{ ok: true }> {
    await this.decisions.updateDecisionEditableFields(decisionId, body);
    return { ok: true };
  }

  @Patch(":decisionId/alternatives/:optionIndex")
  async updateAlternative(
    @Param("decisionId") decisionId: string,
    @Param("optionIndex") optionIndex: string,
    @Body() body: AlternativeUpdateBody,
  ): Promise<{ ok: true }> {
    const idx = Number(optionIndex);
    if (!Number.isInteger(idx) || idx < 0) {
      throw new Error(`Invalid alternative option index: ${optionIndex}`);
    }
    await this.decisions.updateAlternativeEditableFields(decisionId, idx, body);
    return { ok: true };
  }

  @Get(":decisionId/slots/:slot/conversations/:conversationId")
  async getConversation(
    @Param("decisionId") decisionId: string,
    @Param("slot") slot: string,
    @Param("conversationId") conversationId: string,
  ): Promise<DecisionConversationDetailData> {
    return this.decisions.getDecisionConversationDetail(
      decisionId,
      slot,
      conversationId,
    );
  }

  @Get(":decisionId/slots/:slot/documents/:documentId")
  async getDocument(
    @Param("decisionId") decisionId: string,
    @Param("slot") slot: string,
    @Param("documentId") documentId: string,
  ): Promise<DecisionDocumentDetailData> {
    return this.decisions.getDecisionDocumentDetail(
      decisionId,
      slot,
      documentId,
    );
  }
}
