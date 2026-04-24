import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import {
  ConversationSchema,
  buildTurnMap,
  formatEnrichedTopicMarkdown,
  isIrrelevant,
  resolveIdeaUnitDetail,
  type Conversation,
  type EnrichedTopic,
  type IdeaUnitDetail,
} from "../../../shared-contracts/conversation.js";
import { DocumentSchema, type Document } from "../../../shared-contracts/documents.js";
import {
  PotentialTopicsSchema,
  type ConversationIdeaUnit,
  type Decision,
  type TopicItem,
  type TopicOverview,
} from "../../../shared-contracts/topics.js";
import {
  KnowledgeRepository,
  type NewTopicInput,
  type TopicDetail,
} from "./knowledge.repository.js";
import type { DecisionSupportSlot } from "./knowledge.types.js";

export interface AddTopicInput {
  id?: string;
  title: string;
  short_summary: string;
  long_summary?: string;
}

export interface MergeConversationResult {
  conversation_id: string;
  topics_added: number;
  topics_updated: number;
  decisions_added: number;
}

export interface TopicForReview {
  topic_id: string;
  topic_title: string;
  num_items: number;
  has_decision_units: boolean;
  markdown: string;
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
    const ideaUnits = countIdeaUnits(conversation);
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

  async getTopicForReview(conversationPath: string): Promise<TopicForReview | null> {
    const conversation = await this.readConversation(conversationPath);
    const topic = conversation.topics.find((t) => !t.reviewed) ?? null;
    if (topic === null) return null;

    const currentTurnMap = buildTurnMap(conversation.turns);
    const priorDetails = await this.repository.getPriorIdeaUnits(
      topic.id,
      conversation.conversation_id,
    );

    const details: IdeaUnitDetail[] = [];
    const seen = new Set<string>();

    for (const item of topic.items) {
      if (item.type !== "conversation_idea_unit") continue;
      const key = itemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      const detail = resolveIdeaUnitDetail(item, currentTurnMap);
      if (detail === null || isIrrelevant(detail.categories)) continue;
      details.push(detail);
    }

    for (const prior of priorDetails) {
      const key = `${prior.conversation_id}:${prior.turn_index}:${prior.idea_unit_index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (isIrrelevant(prior.categories)) continue;
      details.push(prior);
    }

    const enriched: EnrichedTopic = {
      id: topic.id,
      title: topic.title,
      short_summary: topic.short_summary,
      long_summary: topic.long_summary,
      conversation_id: conversation.conversation_id,
      idea_units: details,
    };

    return {
      topic_id: topic.id,
      topic_title: topic.title,
      num_items: details.length,
      has_decision_units: details.some((d) => d.categories.includes("Decision")),
      markdown: formatEnrichedTopicMarkdown(enriched),
    };
  }

  async hasConversation(conversationId: string): Promise<boolean> {
    return this.repository.hasConversation(conversationId);
  }

  async listTopics(parentId: string | null): Promise<TopicOverview[]> {
    return this.repository.listTopics(parentId);
  }

  async mergeConversation(workingDir: string): Promise<MergeConversationResult> {
    const conversation = await this.readConversation(
      join(workingDir, "conversation.json"),
    );
    const parentMap = await this.readParentMap(workingDir);

    await this.repository.insertConversation(conversation);

    let topicsAdded = 0;
    let topicsUpdated = 0;
    for (const topic of conversation.topics) {
      const existed = await this.repository.topicExists(topic.id);
      if (existed) {
        await this.repository.updateTopicFields(topic.id, {
          title: topic.title,
          short_summary: topic.short_summary,
          long_summary: topic.long_summary,
        });
        topicsUpdated++;
      } else {
        await this.repository.addTopic({
          id: topic.id,
          title: topic.title,
          short_summary: topic.short_summary,
          long_summary: topic.long_summary,
        });
        topicsAdded++;
      }
    }

    for (const topic of conversation.topics) {
      if (!parentMap.has(topic.id)) continue;
      const parentId = parentMap.get(topic.id) ?? null;
      await this.repository.reparentTopic(topic.id, parentId);
    }

    for (const topic of conversation.topics) {
      if (topic.items.length === 0) continue;
      await this.repository.addItemsToTopic(topic.id, topic.items);
    }

    let decisionsAdded = 0;
    for (const topic of conversation.topics) {
      for (const decision of topic.decisions) {
        await this.repository.addDecision(topic.id, decision);
        decisionsAdded++;
      }
    }

    this.logger.log(
      `Merged conversation ${conversation.conversation_id}: +${topicsAdded} topics, ~${topicsUpdated} updated, +${decisionsAdded} decisions`,
    );

    return {
      conversation_id: conversation.conversation_id,
      topics_added: topicsAdded,
      topics_updated: topicsUpdated,
      decisions_added: decisionsAdded,
    };
  }

  async onModuleInit(): Promise<void> {
    await this.repository.initSchema();
  }

  async readTopic(topicId: string): Promise<TopicDetail | null> {
    return this.repository.readTopic(topicId);
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

  private async readParentMap(
    workingDir: string,
  ): Promise<Map<string, string | null>> {
    const path = join(workingDir, "potential_topics.json");
    if (!existsSync(path)) return new Map();
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    const { topics } = PotentialTopicsSchema.parse(parsed);
    const map = new Map<string, string | null>();
    for (const t of topics) {
      if (t.is_new) map.set(t.id, t.parent_id);
    }
    return map;
  }
}

function countIdeaUnits(conversation: Conversation): number {
  return conversation.turns.reduce((sum, t) => sum + t.idea_units.length, 0);
}

function itemKey(item: ConversationIdeaUnit): string {
  return `${item.conversation_id}:${item.turn_index}:${item.idea_unit_index}`;
}

function toNewTopic(input: AddTopicInput): NewTopicInput {
  return {
    id: input.id ?? randomUUID(),
    title: input.title,
    short_summary: input.short_summary,
    long_summary: input.long_summary ?? "",
  };
}
