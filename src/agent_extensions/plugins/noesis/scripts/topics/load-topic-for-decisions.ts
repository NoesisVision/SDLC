import { writeFileSync } from "fs";
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
import type { Topic } from "./types.js";

export function loadTopicForDecisions(
  conversation: Conversation,
  topicId: string | null,
): EnrichedTopic | null {
  const topic =
    topicId !== null
      ? conversation.topics.find((t) => t.id === topicId) ?? null
      : conversation.topics.find((t) => !t.decisions_extracted) ?? null;

  if (topic === null) return null;

  const turnMap = buildTurnMap(conversation.turns);
  return enrichTopicForDecisions(topic, turnMap, conversation.conversation_id);
}

// --- Private functions ---

function enrichTopicForDecisions(
  topic: Topic,
  turnMap: Map<number, Turn>,
  conversationId: string,
): EnrichedTopic {
  const details: IdeaUnitDetail[] = [];

  for (const ref of topic.idea_units) {
    if (ref.conversation_id !== conversationId) continue;
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
  const args = parseArgs(["working_dir"], ["topic_id"]);
  requireDir(args["working_dir"]);

  const conversation = await readJson(
    ConversationSchema,
    join(args["working_dir"], "conversation.json"),
  );

  const topicId = args["topic_id"] ?? null;
  const topic = loadTopicForDecisions(conversation, topicId);

  if (topic === null) {
    outputResult({ status: "Ok", has_topic: false });
    return;
  }

  const topicPath = join(args["working_dir"], "decisions_topic.md");
  writeFileSync(topicPath, formatEnrichedTopicMarkdown(topic), "utf-8");

  outputResult({
    status: "Ok",
    has_topic: true,
    topic_id: topic.id,
    topic_title: topic.title,
    num_idea_units: topic.idea_units.length,
    topic_path: topicPath,
  });
}

if (import.meta.main) {
  main();
}
