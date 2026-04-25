import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { assertNever } from "../../../../shared-contracts/assert-never.js";
import { isIrrelevant } from "../../../../shared-contracts/conversation.js";
import type { TopicItem } from "../../../../shared-contracts/topics.js";
import type {
  TopicConversationDetail,
  TopicConversationRef,
  TopicDocumentDetail,
  TopicDocumentRef,
  TopicNode,
  TopicsPageData,
} from "../../ui-contracts/topics/topics-data.js";
import { ConversationsRepository } from "../conversations/conversations.repository.js";
import { DocumentsRepository } from "../documents/documents.repository.js";
import { ideaUnitNodeId } from "../conversations/node-ids.js";
import {
  TopicsRepository,
  type NewTopicInput,
  type TopicDetail,
  type TopicOverview,
  type TopicWithParent,
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

  async getTopicConversationDetail(
    topicId: string,
    conversationId: string,
  ): Promise<TopicConversationDetail> {
    const topic = await this.repository.readTopic(topicId);
    if (topic === null) throw new Error(`Topic not found: ${topicId}`);
    const conversations =
      await this.conversations.listConversationsForTopic(topicId);
    const conversation = conversations.find(
      (c) => c.conversation_id === conversationId,
    );
    if (conversation === undefined) {
      throw new Error(
        `Conversation ${conversationId} not linked to topic ${topicId}`,
      );
    }
    const ideaUnits =
      await this.conversations.listIdeaUnitsForTopicAndConversation(
        topicId,
        conversationId,
      );
    return {
      topic_id: topic.id,
      topic_title: topic.title,
      conversation_id: conversation.conversation_id,
      conversation_title: conversation.main_topic,
      conversation_date: conversation.time,
      idea_units: ideaUnits
        .filter((iu) => !isIrrelevant(iu.categories))
        .map((iu) => ({
          turn_index: iu.turn_index,
          idea_unit_index: iu.idea_unit_index,
          time: iu.time,
          speaker: iu.speaker,
          sentences: iu.sentences,
          categories: iu.categories,
        })),
    };
  }

  async getTopicDocumentDetail(
    topicId: string,
    documentId: string,
  ): Promise<TopicDocumentDetail> {
    const topic = await this.repository.readTopic(topicId);
    if (topic === null) throw new Error(`Topic not found: ${topicId}`);
    const documents = await this.documents.listDocumentsForTopic(topicId);
    const document = documents.find((d) => d.document_id === documentId);
    if (document === undefined) {
      throw new Error(
        `Document ${documentId} not linked to topic ${topicId}`,
      );
    }
    const fragments = await this.documents.listFragmentsForTopicAndDocument(
      topicId,
      documentId,
    );
    return {
      topic_id: topic.id,
      topic_title: topic.title,
      document_id: document.document_id,
      document_title: document.title,
      document_date: document.date,
      fragments,
    };
  }

  async getTopicsPage(): Promise<TopicsPageData> {
    const allTopics = await this.repository.listAllTopicsWithParents();
    const conversationsById = new Map<string, TopicConversationRef[]>();
    const documentsById = new Map<string, TopicDocumentRef[]>();
    for (const topic of allTopics) {
      conversationsById.set(
        topic.id,
        (await this.conversations.listConversationsForTopic(topic.id)).map(
          (c) => ({
            conversation_id: c.conversation_id,
            title: c.main_topic,
            date: c.time,
          }),
        ),
      );
      documentsById.set(
        topic.id,
        (await this.documents.listDocumentsForTopic(topic.id)).map((d) => ({
          document_id: d.document_id,
          title: d.title,
          date: d.date,
        })),
      );
    }
    return { topics: buildTopicForest(allTopics, conversationsById, documentsById) };
  }

  async listAllTopicsWithParents(): Promise<TopicWithParent[]> {
    return this.repository.listAllTopicsWithParents();
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

function buildTopicForest(
  topics: TopicWithParent[],
  conversationsById: Map<string, TopicConversationRef[]>,
  documentsById: Map<string, TopicDocumentRef[]>,
): TopicNode[] {
  const nodeById = new Map<string, TopicNode>();
  for (const t of topics) {
    nodeById.set(t.id, {
      id: t.id,
      title: t.title,
      short_summary: t.short_summary,
      long_summary: t.long_summary,
      conversations: conversationsById.get(t.id) ?? [],
      documents: documentsById.get(t.id) ?? [],
      subtopics: [],
    });
  }

  const roots: TopicNode[] = [];
  for (const t of topics) {
    const node = nodeById.get(t.id)!;
    if (t.parent_id === null) {
      roots.push(node);
      continue;
    }
    const parent = nodeById.get(t.parent_id);
    if (parent === undefined) {
      roots.push(node);
      continue;
    }
    parent.subtopics.push(node);
  }

  sortForestByTitle(roots);
  return roots;
}

function sortForestByTitle(nodes: TopicNode[]): void {
  nodes.sort((a, b) => a.title.localeCompare(b.title));
  for (const n of nodes) sortForestByTitle(n.subtopics);
}

function toNewTopic(input: AddTopicInput): NewTopicInput {
  return {
    id: input.id ?? randomUUID(),
    title: input.title,
    short_summary: input.short_summary,
    long_summary: input.long_summary ?? "",
  };
}
