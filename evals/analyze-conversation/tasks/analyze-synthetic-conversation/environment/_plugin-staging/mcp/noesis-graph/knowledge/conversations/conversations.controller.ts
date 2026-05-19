import { Controller, Get, Param } from "@nestjs/common";
import type {
  ConversationDetailData,
  ConversationsPageData,
} from "../../ui-contracts/conversations/conversations-data.js";
import { ConversationsService } from "./conversations.service.js";

@Controller("api/ui/conversations")
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  async get(): Promise<ConversationsPageData> {
    return this.conversations.getConversationsPage();
  }

  @Get(":conversationId")
  async getDetail(
    @Param("conversationId") conversationId: string,
  ): Promise<ConversationDetailData> {
    return this.conversations.getConversationDetail(conversationId);
  }
}
