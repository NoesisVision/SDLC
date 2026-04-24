import { randomUUID } from "crypto";
import type { PotentialTopic, Topic } from "../../shared-contracts/topics.js";

export function appendNewTopics(
  existingTopics: PotentialTopic[],
  newTopics: PotentialTopic[],
): PotentialTopic[] {
  const existingIds = new Set(existingTopics.map((t) => t.id));
  const merged = [...existingTopics];
  for (const topic of newTopics) {
    if (!existingIds.has(topic.id)) {
      merged.push(topic);
    }
  }
  return merged;
}

export function createTopicFromPotential(
  topicId: string,
  potentialTopics: PotentialTopic[],
): Topic {
  const match = potentialTopics.find((t) => t.id === topicId);
  return {
    id: topicId,
    title: match?.title ?? "",
    short_summary: match?.short_summary ?? "",
    long_summary: "",
    items: [],
    decisions: [],
    reviewed: false,
    decisions_extracted: false,
  };
}

export function findTopicOrFail(topics: Topic[], topicId: string): Topic {
  const topic = topics.find((t) => t.id === topicId);
  if (topic === undefined) {
    throw new Error(`Topic not found: ${topicId}`);
  }
  return topic;
}

export function replacePlaceholderIds(
  newTopics: PotentialTopic[],
  updateReference: (oldId: string, newId: string) => void,
): void {
  const idMap = new Map<string, string>();

  for (const topic of newTopics) {
    if (topic.is_new) {
      const realId = randomUUID();
      idMap.set(topic.id, realId);
      topic.id = realId;
    }
  }

  for (const topic of newTopics) {
    if (topic.parent_id !== null && idMap.has(topic.parent_id)) {
      topic.parent_id = idMap.get(topic.parent_id)!;
    }
  }

  for (const [oldId, newId] of idMap) {
    updateReference(oldId, newId);
  }
}
