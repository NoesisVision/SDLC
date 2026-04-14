import { existsSync } from "fs";
import { join } from "path";
import { outputResult, parseArgs, readJson, requireDir, writeJson } from "../io.js";
import { ConversationSchema } from "../conversation/types.js";
import type { Conversation } from "../conversation/types.js";
import { PotentialTopicsSchema, findTopicInHierarchy } from "../topics/types.js";
import type { Topic } from "../topics/types.js";
import { KnowledgeGraphSchema } from "./types.js";
import type { ConversationSummary, KnowledgeGraph } from "./types.js";

const NOT_FOUND = Symbol("NOT_FOUND");

export function mergeToKnowledgeGraph(
  conversation: Conversation,
  kg: KnowledgeGraph,
  parentMap: Map<string, string | null>,
): void {
  mergeConversationSummary(kg, conversation);
  mergeTopics(kg, conversation, parentMap);
  mergeDecisions(kg, conversation);
}

// --- Private functions (alphabetical) ---

function buildKgTopic(convTopic: Topic): Topic {
  return {
    id: convTopic.id,
    title: convTopic.title,
    short_summary: convTopic.short_summary,
    long_summary: convTopic.long_summary,
    idea_units: [...convTopic.idea_units],
    subtopics: [],
    reviewed: false,
    decisions_extracted: false,
  };
}

function findParentId(
  topics: Topic[],
  topicId: string,
): string | null {
  const result = findParentIdRecursive(topics, topicId, null);
  if (result === NOT_FOUND) {
    return null;
  }
  return result;
}

function findParentIdRecursive(
  topics: Topic[],
  topicId: string,
  parentId: string | null,
): string | null | typeof NOT_FOUND {
  for (const topic of topics) {
    if (topic.id === topicId) {
      return parentId;
    }
    const result = findParentIdRecursive(topic.subtopics, topicId, topic.id);
    if (result !== NOT_FOUND) {
      return result;
    }
  }
  return NOT_FOUND;
}

function insertTopic(
  kg: KnowledgeGraph,
  topic: Topic,
  parentId: string | null,
): void {
  if (parentId === null) {
    kg.topics.push(topic);
    return;
  }

  const parent = findTopicInHierarchy(kg.topics, parentId);
  if (parent !== null) {
    parent.subtopics.push(topic);
  } else {
    kg.topics.push(topic);
  }
}

function mergeConversationSummary(
  kg: KnowledgeGraph,
  conversation: Conversation,
): void {
  const summary: ConversationSummary = {
    conversation_id: conversation.conversation_id,
    time: conversation.time,
    main_topic: conversation.main_topic,
    turns: conversation.turns,
  };

  const existingIndex = kg.conversations.findIndex(
    (c) => c.conversation_id === conversation.conversation_id,
  );

  if (existingIndex >= 0) {
    kg.conversations[existingIndex] = summary;
  } else {
    kg.conversations.push(summary);
  }
}

function mergeDecisions(
  kg: KnowledgeGraph,
  conversation: Conversation,
): void {
  kg.decisions.push(...conversation.decisions);
}

function mergeSingleTopic(
  kg: KnowledgeGraph,
  convTopic: Topic,
  parentMap: Map<string, string | null>,
): void {
  const targetParentId = parentMap.get(convTopic.id) ?? null;
  const existing = findTopicInHierarchy(kg.topics, convTopic.id);

  if (existing !== null) {
    const currentParentId = findParentId(kg.topics, convTopic.id);
    updateExistingTopic(existing, convTopic);
    if (currentParentId !== targetParentId) {
      reparentTopic(kg, existing, currentParentId, targetParentId);
    }
  } else {
    const newTopic = buildKgTopic(convTopic);
    insertTopic(kg, newTopic, targetParentId);
  }
}

function mergeTopics(
  kg: KnowledgeGraph,
  conversation: Conversation,
  parentMap: Map<string, string | null>,
): void {
  for (const convTopic of conversation.topics) {
    mergeSingleTopic(kg, convTopic, parentMap);
  }
}

function removeTopicFromParent(
  kg: KnowledgeGraph,
  topicId: string,
  parentId: string | null,
): void {
  if (parentId === null) {
    kg.topics = kg.topics.filter((t) => t.id !== topicId);
  } else {
    const parent = findTopicInHierarchy(kg.topics, parentId);
    if (parent !== null) {
      parent.subtopics = parent.subtopics.filter((t) => t.id !== topicId);
    }
  }
}

function reparentTopic(
  kg: KnowledgeGraph,
  topic: Topic,
  oldParentId: string | null,
  newParentId: string | null,
): void {
  removeTopicFromParent(kg, topic.id, oldParentId);
  insertTopic(kg, topic, newParentId);
}

function updateExistingTopic(existing: Topic, convTopic: Topic): void {
  existing.title = convTopic.title;
  existing.short_summary = convTopic.short_summary;
  existing.long_summary = convTopic.long_summary;

  const existingKeys = new Set(
    existing.idea_units.map(
      (ref) => `${ref.conversation_id}:${ref.turn_index}:${ref.idea_unit_index}`,
    ),
  );

  for (const ref of convTopic.idea_units) {
    const key = `${ref.conversation_id}:${ref.turn_index}:${ref.idea_unit_index}`;
    if (!existingKeys.has(key)) {
      existing.idea_units.push(ref);
    }
  }
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

  const potentialPath = join(args["working_dir"], "potential_topics.json");
  const parentMap = new Map<string, string | null>();
  if (existsSync(potentialPath)) {
    const potentialTopics = await readJson(PotentialTopicsSchema, potentialPath);
    for (const t of potentialTopics.topics) {
      parentMap.set(t.id, t.parent_id);
    }
  }

  mergeToKnowledgeGraph(conversation, kg, parentMap);
  await writeJson(kgPath, kg);

  outputResult({ status: "Ok" });
}

if (import.meta.main) {
  main();
}
