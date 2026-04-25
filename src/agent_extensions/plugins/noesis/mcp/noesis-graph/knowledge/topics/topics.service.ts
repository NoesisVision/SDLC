import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { assertNever } from "../../../../shared-contracts/assert-never.js";
import type { TopicItem } from "../../../../shared-contracts/topics.js";
import { ConversationsRepository } from "../conversations/conversations.repository.js";
import { DocumentsRepository } from "../documents/documents.repository.js";
import { ideaUnitNodeId } from "../conversations/node-ids.js";
import {
  TopicsRepository,
  type NewTopicInput,
  type TopicDetail,
  type TopicOverview,
} from "./topics.repository.js";

export interface AddTopicInput {
  id?: string;
  title: string;
  short_summary: string;
  long_summary?: string;
}

export interface UpsertTopicResult {
  added: boolean;
  updated: boolean;
}

@Injectable()
export class TopicsService {
  constructor(
    private readonly repository: TopicsRepository,
    private readonly conversations: ConversationsRepository,
    private readonly documents: DocumentsRepository,
  ) {}

  async addItemsToTopic(
    topicId: string,
    items: TopicItem[],
  ): Promise<{ added: number }> {
    await this.repository.require(topicId);
    await this.requireSupportingItems(items);

    for (const item of items) {
      switch (item.type) {
        case "idea_unit_ref": {
          const iuId = ideaUnitNodeId(
            item.conversation_id,
            item.turn_index,
            item.idea_unit_index,
          );
          await this.repository.linkToIdeaUnit(topicId, iuId);
          break;
        }
        case "document_fragment_ref": {
          const fragId = await this.documents.ensureFragmentNode(
            item.document_id,
            item.start_offset,
            item.end_offset,
          );
          await this.repository.linkToDocumentFragment(topicId, fragId);
          break;
        }
        default:
          assertNever(item);
      }
    }
    return { added: items.length };
  }

  async addSubtopic(
    parentTopicId: string,
    input: AddTopicInput,
  ): Promise<{ id: string }> {
    const topic = toNewTopic(input);
    await this.repository.require(parentTopicId);
    await this.repository.ensureNotExists(topic.id);
    await this.repository.insertTopicNode(topic);
    await this.repository.linkSubtopic(parentTopicId, topic.id);
    return { id: topic.id };
  }

  async addTopic(input: AddTopicInput): Promise<{ id: string }> {
    const topic = toNewTopic(input);
    await this.repository.ensureNotExists(topic.id);
    await this.repository.insertTopicNode(topic);
    return { id: topic.id };
  }

  async listTopics(parentId: string | null): Promise<TopicOverview[]> {
    return parentId === null
      ? this.repository.listRootTopics()
      : this.repository.listSubtopics(parentId);
  }

  async readTopic(topicId: string): Promise<TopicDetail | null> {
    return this.repository.readTopic(topicId);
  }

  async reparentTopic(
    topicId: string,
    newParentTopicId: string | null,
  ): Promise<{ topic_id: string; new_parent_topic_id: string | null }> {
    await this.repository.require(topicId);
    if (newParentTopicId !== null) {
      await this.repository.require(newParentTopicId);
      if (newParentTopicId === topicId) {
        throw new Error(`Topic cannot be its own parent: ${topicId}`);
      }
    }
    await this.repository.deleteParentEdge(topicId);
    if (newParentTopicId !== null) {
      await this.repository.linkSubtopic(newParentTopicId, topicId);
    }
    return { topic_id: topicId, new_parent_topic_id: newParentTopicId };
  }

  async upsertTopic(input: NewTopicInput): Promise<UpsertTopicResult> {
    if (await this.repository.exists(input.id)) {
      await this.repository.updateTopicFields(input.id, {
        title: input.title,
        short_summary: input.short_summary,
        long_summary: input.long_summary,
      });
      return { added: false, updated: true };
    }
    await this.repository.insertTopicNode(input);
    return { added: true, updated: false };
  }

  private async requireSupportingItems(items: TopicItem[]): Promise<void> {
    for (const item of items) {
      switch (item.type) {
        case "idea_unit_ref":
          await this.conversations.requireIdeaUnit(
            item.conversation_id,
            item.turn_index,
            item.idea_unit_index,
          );
          break;
        case "document_fragment_ref":
          await this.documents.requireDocument(item.document_id);
          break;
        default:
          assertNever(item);
      }
    }
  }
}

function toNewTopic(input: AddTopicInput): NewTopicInput {
  return {
    id: input.id ?? randomUUID(),
    title: input.title,
    short_summary: input.short_summary,
    long_summary: input.long_summary ?? "",
  };
}
