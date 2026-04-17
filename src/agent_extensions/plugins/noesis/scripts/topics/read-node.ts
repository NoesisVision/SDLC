import { outputResult, parseArgs, readJson } from "../io.js";
import { KnowledgeGraphSchema } from "../../shared-contracts/knowledge-graph.js";
import { buildTopicPath, findTopicInHierarchy } from "../../shared-contracts/topics.js";
import type { Topic } from "../../shared-contracts/topics.js";

export interface NodeDetail {
  id: string;
  title: string;
  path: string[];
  short_summary: string;
  long_summary: string;
}

export function readNode(topics: Topic[], topicId: string): NodeDetail | null {
  const topic = findTopicInHierarchy(topics, topicId);
  if (topic === null) return null;

  return {
    id: topic.id,
    title: topic.title,
    path: buildTopicPath(topics, topicId),
    short_summary: topic.short_summary,
    long_summary: topic.long_summary,
  };
}

// --- Entry point ---

async function main(): Promise<void> {
  const args = parseArgs(["knowledge_graph_path", "topic_id"]);

  const kg = await readJson(KnowledgeGraphSchema, args["knowledge_graph_path"]);
  const detail = readNode(kg.topics, args["topic_id"]);

  if (detail === null) {
    outputResult({ status: "NotFound", topic_id: args["topic_id"] });
    return;
  }

  outputResult({ status: "Ok", ...detail });
}

if (import.meta.main) {
  main();
}
