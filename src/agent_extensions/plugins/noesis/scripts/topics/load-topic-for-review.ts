import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { outputResult, parseArgs, readJson, requireDir } from "../io.js";
import {
  ConversationSchema,
  buildTurnMap,
  formatEnrichedTopicMarkdown,
  isIrrelevant,
  resolveIdeaUnitDetail,
} from "../../shared-contracts/conversation.js";
import type {
  Conversation,
  EnrichedTopic,
  IdeaUnitDetail,
  Turn,
} from "../../shared-contracts/conversation.js";
import { KnowledgeGraphSchema } from "../../shared-contracts/knowledge-graph.js";
import type { KnowledgeGraph } from "../../shared-contracts/knowledge-graph.js";
import { findTopicInHierarchy } from "../../shared-contracts/topics.js";
import type { ConversationIdeaUnit, Topic } from "../../shared-contracts/topics.js";

export function loadTopicForReview(
  conversation: Conversation,
  kg: KnowledgeGraph,
): EnrichedTopic | null {
  const topic = conversation.topics.find((t) => !t.reviewed) ?? null;
  if (topic === null) return null;

  const kgTopic = findTopicInHierarchy(kg.topics, topic.id);
  const currentTurnMap = buildTurnMap(conversation.turns);
  const kgTurnMaps = buildKgTurnMaps(kg, conversation.conversation_id);
  const allRefs = collectUniqueConversationIdeaUnits(topic, kgTopic);

  return enrichTopic(topic, allRefs, currentTurnMap, kgTurnMaps, conversation.conversation_id);
}

// --- Private functions ---

function buildKgTurnMaps(
  kg: KnowledgeGraph,
  currentConversationId: string,
): Map<string, Map<number, Turn>> {
  const result = new Map<string, Map<number, Turn>>();
  for (const conv of kg.conversations) {
    if (conv.conversation_id === currentConversationId) continue;
    result.set(conv.conversation_id, buildTurnMap(conv.turns));
  }
  return result;
}

function collectUniqueConversationIdeaUnits(
  convTopic: Topic,
  kgTopic: Topic | null,
): ConversationIdeaUnit[] {
  const seen = new Set<string>();
  const allRefs: ConversationIdeaUnit[] = [];

  const addRefs = (topic: Topic) => {
    for (const item of topic.items) {
      if (item.type !== "conversation_idea_unit") continue;
      const key = `${item.conversation_id}:${item.turn_index}:${item.idea_unit_index}`;
      if (!seen.has(key)) {
        seen.add(key);
        allRefs.push(item);
      }
    }
  };

  addRefs(convTopic);
  if (kgTopic !== null) addRefs(kgTopic);

  return allRefs;
}

function enrichTopic(
  topic: Topic,
  allRefs: ConversationIdeaUnit[],
  currentTurnMap: Map<number, Turn>,
  kgTurnMaps: Map<string, Map<number, Turn>>,
  conversationId: string,
): EnrichedTopic {
  const details: IdeaUnitDetail[] = [];

  for (const ref of allRefs) {
    const turnMap = kgTurnMaps.get(ref.conversation_id) ?? currentTurnMap;
    const detail = resolveIdeaUnitDetail(ref, turnMap);
    if (detail === null || isIrrelevant(detail.categories)) continue;
    details.push(detail);
  }

  return {
    id: topic.id,
    title: topic.title,
    short_summary: topic.short_summary,
    long_summary: topic.long_summary,
    conversation_id: conversationId,
    idea_units: details,
  };
}

// --- Entry point ---

async function main(): Promise<void> {
  const args = parseArgs(["working_dir", "knowledge_graph_path"]);
  requireDir(args["working_dir"]);

  const conversation = await readJson(
    ConversationSchema,
    join(args["working_dir"], "conversation.json"),
  );

  const kgPath = args["knowledge_graph_path"];
  const kg = existsSync(kgPath)
    ? await readJson(KnowledgeGraphSchema, kgPath)
    : { conversations: [], topics: [], decisions: [] };

  const topic = loadTopicForReview(conversation, kg);

  if (topic === null) {
    outputResult({ status: "Ok", has_topic: false });
    return;
  }

  const topicPath = join(args["working_dir"], "review_topic.md");
  writeFileSync(topicPath, formatEnrichedTopicMarkdown(topic), "utf-8");

  const hasDecisionUnits = topic.idea_units.some(
    (iu) => iu.categories.includes("Decision"),
  );

  outputResult({
    status: "Ok",
    has_topic: true,
    topic_id: topic.id,
    topic_title: topic.title,
    num_items: topic.idea_units.length,
    has_decision_units: hasDecisionUnits,
    topic_path: topicPath,
  });
}

if (import.meta.main) {
  main();
}
