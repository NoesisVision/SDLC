import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { outputResult, parseArgs, readJson, requireDir } from "../io.js";
import {
  ConversationSchema,
  buildTurnMap,
  formatEnrichedTopicMarkdown,
  isIrrelevant,
  resolveIdeaUnitDetail,
} from "../conversation/types.js";
import type {
  Conversation,
  EnrichedTopic,
  IdeaUnitDetail,
  Turn,
} from "../conversation/types.js";
import { KnowledgeGraphSchema } from "../knowledge-graph/types.js";
import type { KnowledgeGraph } from "../knowledge-graph/types.js";
import { findTopicInHierarchy } from "./types.js";
import type { IdeaUnitRef, Topic } from "./types.js";

export function loadTopicForReview(
  conversation: Conversation,
  kg: KnowledgeGraph,
): EnrichedTopic | null {
  const topic = conversation.topics.find((t) => !t.reviewed) ?? null;
  if (topic === null) return null;

  const kgTopic = findTopicInHierarchy(kg.topics, topic.id);
  const currentTurnMap = buildTurnMap(conversation.turns);
  const kgTurnMaps = buildKgTurnMaps(kg, conversation.conversation_id);
  const allRefs = collectUniqueRefs(topic, kgTopic);

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

function collectUniqueRefs(
  convTopic: Topic,
  kgTopic: Topic | null,
): IdeaUnitRef[] {
  const seen = new Set<string>();
  const allRefs: IdeaUnitRef[] = [];

  const addRefs = (refs: IdeaUnitRef[]) => {
    for (const ref of refs) {
      const key = `${ref.conversation_id}:${ref.turn_index}:${ref.idea_unit_index}`;
      if (!seen.has(key)) {
        seen.add(key);
        allRefs.push(ref);
      }
    }
  };

  addRefs(convTopic.idea_units);
  if (kgTopic !== null) addRefs(kgTopic.idea_units);

  return allRefs;
}

function enrichTopic(
  topic: Topic,
  allRefs: IdeaUnitRef[],
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
    num_idea_units: topic.idea_units.length,
    has_decision_units: hasDecisionUnits,
    topic_path: topicPath,
  });
}

if (import.meta.main) {
  main();
}
