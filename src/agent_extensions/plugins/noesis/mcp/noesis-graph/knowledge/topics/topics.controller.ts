import { Controller, Get, Param } from "@nestjs/common";
import type {
  TopicConversationDetail,
  TopicDocumentDetail,
  TopicsPageData,
} from "../../ui-contracts/topics/topics-data.js";
import { TopicsService } from "./topics.service.js";

@Controller("api/ui/topics")
export class TopicsController {
  constructor(private readonly topics: TopicsService) {}

  @Get()
  async get(): Promise<TopicsPageData> {
    return this.topics.getTopicsPage();
  }

  @Get(":topicId/conversations/:conversationId")
  async getConversation(
    @Param("topicId") topicId: string,
    @Param("conversationId") conversationId: string,
  ): Promise<TopicConversationDetail> {
    return this.topics.getTopicConversationDetail(topicId, conversationId);
  }

  @Get(":topicId/documents/:documentId")
  async getDocument(
    @Param("topicId") topicId: string,
    @Param("documentId") documentId: string,
  ): Promise<TopicDocumentDetail> {
    return this.topics.getTopicDocumentDetail(topicId, documentId);
  }
}
