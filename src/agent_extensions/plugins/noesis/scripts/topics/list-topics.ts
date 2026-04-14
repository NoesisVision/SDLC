import { outputResult, parseArgs, readJson } from "../io.js";
import { KnowledgeGraphSchema } from "../knowledge-graph/types.js";
import type { TopicOverview } from "../knowledge-graph/types.js";
import { findTopicInHierarchy } from "./types.js";
import type { Topic } from "./types.js";

export function listTopics(
  topics: Topic[],
  parentId: string | null,
): TopicOverview[] {
  const targets = parentId
    ? (findTopicInHierarchy(topics, parentId)?.subtopics ?? [])
    : topics;

  return targets.map((t) => toOverview(t, buildPath(topics, t.id)));
}

// --- Private functions ---

function buildPath(roots: Topic[], targetId: string): string[] {
  const path: string[] = [];
  findPathRecursive(roots, targetId, path);
  return path;
}

function findPathRecursive(
  topics: Topic[],
  targetId: string,
  path: string[],
): boolean {
  for (const topic of topics) {
    path.push(topic.title);
    if (topic.id === targetId) {
      return true;
    }
    if (findPathRecursive(topic.subtopics, targetId, path)) {
      return true;
    }
    path.pop();
  }
  return false;
}

function toOverview(topic: Topic, path: string[]): TopicOverview {
  return {
    id: topic.id,
    title: topic.title,
    short_summary: topic.short_summary,
    long_summary: topic.long_summary,
    has_subtopics: topic.subtopics.length > 0,
    path,
  };
}

// --- Entry point ---

async function main(): Promise<void> {
  const args = parseArgs(["knowledge_graph_path"], ["parent_id"]);

  const kg = await readJson(KnowledgeGraphSchema, args["knowledge_graph_path"]);
  const parentId = args["parent_id"] ?? null;
  const overviews = listTopics(kg.topics, parentId);

  outputResult({ status: "Ok", topics: overviews });
}

if (import.meta.main) {
  main();
}
