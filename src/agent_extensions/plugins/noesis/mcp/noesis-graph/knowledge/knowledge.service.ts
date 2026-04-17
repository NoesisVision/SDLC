import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { readFile } from "fs/promises";
import { randomUUID } from "crypto";
import {
  ConversationSchema,
  type Conversation,
} from "../../../shared-contracts/conversation.js";
import { DocumentSchema, type Document } from "../../../shared-contracts/documents.js";
import type {
  Decision,
  TopicItem,
} from "../../../shared-contracts/topics.js";
import { KnowledgeRepository } from "./knowledge.repository.js";
import type { DecisionSupportSlot } from "./knowledge.types.js";

export interface AddTopicInput {
  id?: string;
  title: string;
  short_summary: string;
  long_summary?: string;
}

@Injectable()
export class KnowledgeService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(private readonly repository: KnowledgeRepository) {}

  async addConversationFromFile(path: string): Promise<{
    conversation_id: string;
    turns: number;
    idea_units: number;
  }> {
    const conversation = await this.readConversation(path);
    await this.repository.insertConversation(conversation);
    const ideaUnits = conversation.turns.reduce(
      (sum, t) => sum + t.idea_units.length,
      0,
    );
    this.logger.log(
      `Added conversation ${conversation.conversation_id} (${conversation.turns.length} turns, ${ideaUnits} idea units)`,
    );
    return {
      conversation_id: conversation.conversation_id,
      turns: conversation.turns.length,
      idea_units: ideaUnits,
    };
  }

  async addDecision(
    topicId: string,
    decision: Decision,
  ): Promise<{ id: string }> {
    await this.repository.addDecision(topicId, decision);
    return { id: decision.id };
  }

  async addDocumentFromFile(path: string): Promise<{ id: string }> {
    const document = await this.readDocument(path);
    await this.repository.insertDocument(document);
    this.logger.log(`Added document ${document.id}`);
    return { id: document.id };
  }

  async addItemsToDecisionSlot(
    decisionId: string,
    slot: DecisionSupportSlot,
    items: TopicItem[],
  ): Promise<{ added: number }> {
    await this.repository.addItemsToDecisionSlot(decisionId, slot, items);
    return { added: items.length };
  }

  async addItemsToTopic(
    topicId: string,
    items: TopicItem[],
  ): Promise<{ added: number }> {
    await this.repository.addItemsToTopic(topicId, items);
    return { added: items.length };
  }

  async addSubtopic(
    parentTopicId: string,
    input: AddTopicInput,
  ): Promise<{ id: string }> {
    const topic = toNewTopic(input);
    await this.repository.addSubtopic(parentTopicId, topic);
    return { id: topic.id };
  }

  async addTopic(input: AddTopicInput): Promise<{ id: string }> {
    const topic = toNewTopic(input);
    await this.repository.addTopic(topic);
    return { id: topic.id };
  }

  async onModuleInit(): Promise<void> {
    await this.repository.initSchema();
  }

  async reparentTopic(
    topicId: string,
    newParentTopicId: string | null,
  ): Promise<{ topic_id: string; new_parent_topic_id: string | null }> {
    await this.repository.reparentTopic(topicId, newParentTopicId);
    return { topic_id: topicId, new_parent_topic_id: newParentTopicId };
  }

  private async readConversation(path: string): Promise<Conversation> {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    return ConversationSchema.parse(parsed);
  }

  private async readDocument(path: string): Promise<Document> {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    return DocumentSchema.parse(parsed);
  }
}

function toNewTopic(input: AddTopicInput): {
  id: string;
  title: string;
  short_summary: string;
  long_summary: string;
  reviewed: boolean;
  decisions_extracted: boolean;
} {
  return {
    id: input.id ?? randomUUID(),
    title: input.title,
    short_summary: input.short_summary,
    long_summary: input.long_summary ?? "",
    reviewed: false,
    decisions_extracted: false,
  };
}
