import { join } from "path";
import { deleteFile, outputResult, parseArgs, readJson, requireDir, requireFile, writeJson } from "../io.js";
import {
  ConversationSchema,
  TopicReviewResultSchema,
} from "../conversation/types.js";
import type { Conversation, TopicReviewResult } from "../conversation/types.js";
import {
  PotentialTopicsSchema,
  appendNewTopics,
  createTopicFromPotential,
  findTopicOrFail,
  replacePlaceholderIds,
} from "./types.js";
import type { Topic } from "./types.js";

export function saveTopicReview(
  conversation: Conversation,
  review: TopicReviewResult,
): void {
  const topic = findTopicOrFail(conversation.topics, review.topic_id);
  topic.short_summary = review.short_summary;
  topic.long_summary = review.long_summary;
  applyReassignments(conversation, topic, review);
  topic.reviewed = true;
}

// --- Private functions ---

function applyReassignments(
  conversation: Conversation,
  sourceTopic: Topic,
  review: TopicReviewResult,
): void {
  const topicMap = new Map(conversation.topics.map((t) => [t.id, t]));
  const reassignedKeys = new Set(
    review.reassignments.map((r) => `${r.turn_index}:${r.idea_unit_index}`),
  );

  sourceTopic.idea_units = sourceTopic.idea_units.filter(
    (ref) => !reassignedKeys.has(`${ref.turn_index}:${ref.idea_unit_index}`),
  );

  for (const reassignment of review.reassignments) {
    let target = topicMap.get(reassignment.new_topic_id);
    if (target === undefined) {
      target = createTopicFromPotential(reassignment.new_topic_id, review.new_topics);
      conversation.topics.push(target);
      topicMap.set(target.id, target);
    }

    target.idea_units.push({
      conversation_id: conversation.conversation_id,
      turn_index: reassignment.turn_index,
      idea_unit_index: reassignment.idea_unit_index,
    });
  }
}

// --- Entry point ---

async function main(): Promise<void> {
  const args = parseArgs(["working_dir", "input_file"]);
  requireDir(args["working_dir"]);
  requireFile(args["input_file"]);

  const conversation = await readJson(
    ConversationSchema,
    join(args["working_dir"], "conversation.json"),
  );
  const review = await readJson(TopicReviewResultSchema, args["input_file"]);

  replacePlaceholderIds(review.new_topics, (oldId, newId) => {
    for (const r of review.reassignments) {
      if (r.new_topic_id === oldId) r.new_topic_id = newId;
    }
  });
  saveTopicReview(conversation, review);
  await writeJson(join(args["working_dir"], "conversation.json"), conversation);

  if (review.new_topics.length > 0) {
    const potentialPath = join(args["working_dir"], "potential_topics.json");
    const existing = await readJson(PotentialTopicsSchema, potentialPath);
    const merged = appendNewTopics(existing.topics, review.new_topics);
    await writeJson(potentialPath, { topics: merged });
  }

  deleteFile(args["input_file"]);

  outputResult({
    status: "Ok",
    topic_id: review.topic_id,
    reassignments: review.reassignments.length,
    new_topics: review.new_topics.length,
  });
}

if (import.meta.main) {
  main();
}
