import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import type {
  TopicConversationDetail,
  TopicDocumentDetail,
  TopicsPageData,
} from "../../ui-contracts/topics/topics-data.js";
import { TopicsService } from "./topics.service.js";

interface TopicUpdateBody {
  title?: string;
  short_summary?: string;
  long_summary?: string;
}

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

  @Patch(":topicId")
  async update(
    @Param("topicId") topicId: string,
    @Body() body: TopicUpdateBody,
  ): Promise<{ ok: true }> {
    await this.topics.updateTopicEditableFields(topicId, body);
    return { ok: true };
  }
}
