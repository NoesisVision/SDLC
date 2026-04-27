import { Injectable, Logger } from "@nestjs/common";
import { readFile } from "fs/promises";
import { join } from "path";
import {
  ConversationSchema,
  buildTurnMap,
  formatEnrichedTopicMarkdown,
  isIrrelevant,
  resolveIdeaUnitDetail,
  type Conversation,
  type EnrichedSubtopic,
  type EnrichedTopic,
  type IdeaUnitDetail,
  type IdeaUnitRef,
} from "../../../../shared-contracts/conversation.js";
import { assertNever } from "../../../../shared-contracts/assert-never.js";
import {
  AnalyzeConversationOutputSchema,
  type AnalyzeConversationOutput,
} from "../../../../shared-contracts/skills/analyze-conversation/output.js";
import { DecisionsService } from "../decisions/decisions.service.js";
import { DocumentsRepository } from "../documents/documents.repository.js";
import { TopicsRepository } from "../topics/topics.repository.js";
import { ConversationsRepository } from "./conversations.repository.js";
import { ideaUnitNodeId } from "./node-ids.js";

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
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly repository: ConversationsRepository,
    private readonly topics: TopicsRepository,
    private readonly documents: DocumentsRepository,
    private readonly decisions: DecisionsService,
  ) {}

  async addConversationFromFile(path: string): Promise<{
    conversation_id: string;
    turns: number;
    idea_units: number;
  }> {
    const conversation = await this.readConversationFile(path);
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

  async getTopicForReview(
    outputPath: string,
  ): Promise<TopicForReview | null> {
    const output = await this.readOutputFile(outputPath);
    const { conversation } = output;
    const order = postOrderTopicIds(
      conversation.topics,
      output.potential_topics.topics,
    );
    const topic = pickNextUnreviewed(conversation.topics, order);
    if (topic === null) return null;

    const currentTurnMap = buildTurnMap(conversation.turns);
    const priorDetails = await this.repository.getPriorIdeaUnits(
      topic.id,
      conversation.conversation_id,
    );

    const details: IdeaUnitDetail[] = [];
    const seen = new Set<string>();

    for (const item of topic.items) {
      switch (item.type) {
        case "idea_unit_ref": {
          const key = itemKey(item);
          if (seen.has(key)) break;
          seen.add(key);
          const detail = resolveIdeaUnitDetail(item, currentTurnMap);
          if (detail === null || isIrrelevant(detail.categories)) break;
          details.push(detail);
          break;
        }
        case "document_fragment_ref":
          break;
        default:
          assertNever(item);
      }
    }

    for (const prior of priorDetails) {
      const key = `${prior.conversation_id}:${prior.turn_index}:${prior.idea_unit_index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      details.push(prior);
    }

    const subtopics = collectSubtopics(
      topic.id,
      conversation.topics,
      output.potential_topics.topics,
    );

    const enriched: EnrichedTopic = {
      id: topic.id,
      title: topic.title,
      short_summary: topic.short_summary,
      long_summary: topic.long_summary,
      conversation_id: conversation.conversation_id,
      idea_units: details,
      subtopics,
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
    return this.repository.exists(conversationId);
  }

  async mergeConversation(workingDir: string): Promise<MergeConversationResult> {
    const output = await this.readOutputFile(join(workingDir, "output.json"));
    const { conversation, potential_topics } = output;
    const parentMap = buildParentMap(potential_topics.topics);

    await this.repository.insertConversation(conversation);

    let topicsAdded = 0;
    let topicsUpdated = 0;
    for (const topic of conversation.topics) {
      const fields = {
        title: topic.title,
        short_summary: topic.short_summary,
        long_summary: topic.long_summary,
      };
      if (await this.topics.exists(topic.id)) {
        await this.topics.updateTopicFields(topic.id, fields);
        topicsUpdated++;
      } else {
        await this.topics.insertTopicNode({ id: topic.id, ...fields });
        topicsAdded++;
      }
    }

    for (const topic of conversation.topics) {
      if (!parentMap.has(topic.id)) continue;
      const parentId = parentMap.get(topic.id) ?? null;
      await this.topics.deleteParentEdge(topic.id);
      if (parentId !== null) {
        await this.topics.linkSubtopic(parentId, topic.id);
      }
    }

    for (const topic of conversation.topics) {
      for (const item of topic.items) {
        switch (item.type) {
          case "idea_unit_ref": {
            const iuId = ideaUnitNodeId(
              item.conversation_id,
              item.turn_index,
              item.idea_unit_index,
            );
            await this.topics.linkToIdeaUnit(topic.id, iuId);
            break;
          }
          case "document_fragment_ref": {
            const fragId = await this.documents.ensureFragmentNode(
              item.document_id,
              item.start_offset,
              item.end_offset,
            );
            await this.topics.linkToDocumentFragment(topic.id, fragId);
            break;
          }
          default:
            assertNever(item);
        }
      }
    }

    let decisionsAdded = 0;
    for (const topic of conversation.topics) {
      for (const decision of topic.decisions) {
        await this.decisions.addDecision(topic.id, decision);
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

  private async readConversationFile(path: string): Promise<Conversation> {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    return ConversationSchema.parse(parsed);
  }

  private async readOutputFile(
    path: string,
  ): Promise<AnalyzeConversationOutput> {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    return AnalyzeConversationOutputSchema.parse(parsed);
  }
}

function buildParentLookup(
  potentialTopics: AnalyzeConversationOutput["potential_topics"]["topics"],
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const t of potentialTopics) {
    map.set(t.id, t.parent_id);
  }
  return map;
}

function buildParentMap(
  potentialTopics: AnalyzeConversationOutput["potential_topics"]["topics"],
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const t of potentialTopics) {
    if (t.is_new) map.set(t.id, t.parent_id);
  }
  return map;
}

function collectSubtopics(
  parentId: string,
  topics: Conversation["topics"],
  potentialTopics: AnalyzeConversationOutput["potential_topics"]["topics"],
): EnrichedSubtopic[] {
  const parents = buildParentLookup(potentialTopics);
  const subtopics: EnrichedSubtopic[] = [];
  for (const t of topics) {
    if ((parents.get(t.id) ?? null) !== parentId) continue;
    subtopics.push({
      id: t.id,
      title: t.title,
      short_summary: t.short_summary,
      reviewed: t.reviewed,
    });
  }
  return subtopics;
}

function countIdeaUnits(conversation: Conversation): number {
  return conversation.turns.reduce((sum, t) => sum + t.idea_units.length, 0);
}

function itemKey(item: IdeaUnitRef): string {
  return `${item.conversation_id}:${item.turn_index}:${item.idea_unit_index}`;
}

function pickNextUnreviewed(
  topics: Conversation["topics"],
  order: string[],
): Conversation["topics"][number] | null {
  const byId = new Map(topics.map((t) => [t.id, t] as const));
  for (const id of order) {
    const topic = byId.get(id);
    if (topic !== undefined && !topic.reviewed) return topic;
  }
  return null;
}

function postOrderTopicIds(
  topics: Conversation["topics"],
  potentialTopics: AnalyzeConversationOutput["potential_topics"]["topics"],
): string[] {
  const idSet = new Set(topics.map((t) => t.id));
  const parents = buildParentLookup(potentialTopics);
  const childrenByParent = new Map<string, string[]>();
  const roots: string[] = [];
  for (const t of topics) {
    const declaredParent = parents.get(t.id) ?? null;
    const effectiveParent =
      declaredParent !== null && idSet.has(declaredParent) ? declaredParent : null;
    if (effectiveParent === null) {
      roots.push(t.id);
      continue;
    }
    const siblings = childrenByParent.get(effectiveParent) ?? [];
    siblings.push(t.id);
    childrenByParent.set(effectiveParent, siblings);
  }

  const out: string[] = [];
  const visited = new Set<string>();
  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    for (const child of childrenByParent.get(id) ?? []) visit(child);
    out.push(id);
  }
  for (const root of roots) visit(root);
  for (const t of topics) visit(t.id);
  return out;
}
