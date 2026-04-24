import { join } from "path";
import { z } from "zod";
import { deleteFile, outputResult, parseArgs, readJson, requireDir, requireFile, writeJson } from "../io.js";
import {
  ConversationSchema,
  TurnSchema,
} from "../../shared-contracts/conversation.js";
import type { Conversation } from "../../shared-contracts/conversation.js";
import {
  PotentialTopicSchema,
  PotentialTopicsSchema,
} from "../../shared-contracts/topics.js";
import type { Topic } from "../../shared-contracts/topics.js";
import {
  appendNewTopics,
  createTopicFromPotential,
  replacePlaceholderIds,
} from "./topic-helpers.js";

export const IdeaUnitTopicAssignmentSchema = z.object({
  turn_index: z.int(),
  idea_unit_index: z.int(),
  topic_id: z.string(),
});
export type IdeaUnitTopicAssignment = z.infer<
  typeof IdeaUnitTopicAssignmentSchema
>;

export const ChunkResultSchema = z.object({
  turns: z.array(TurnSchema),
  assignments: z.array(IdeaUnitTopicAssignmentSchema),
  new_topics: z.array(PotentialTopicSchema),
});
export type ChunkResult = z.infer<typeof ChunkResultSchema>;

export function saveChunkResult(
  conversation: Conversation,
  chunkResult: ChunkResult,
): void {
  conversation.turns.push(...chunkResult.turns);
  applyAssignments(conversation, chunkResult);
}

// --- Private functions ---

function applyAssignments(
  conversation: Conversation,
  chunkResult: ChunkResult,
): void {
  const topicMap = new Map<string, Topic>(
    conversation.topics.map((t) => [t.id, t]),
  );

  for (const assignment of chunkResult.assignments) {
    let topic = topicMap.get(assignment.topic_id);
    if (topic === undefined) {
      topic = createTopicFromPotential(assignment.topic_id, chunkResult.new_topics);
      conversation.topics.push(topic);
      topicMap.set(topic.id, topic);
    }

    topic.items.push({
      type: "conversation_idea_unit",
      conversation_id: conversation.conversation_id,
      turn_index: assignment.turn_index,
      idea_unit_index: assignment.idea_unit_index,
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
  const chunkResult = await readJson(ChunkResultSchema, args["input_file"]);

  replacePlaceholderIds(chunkResult.new_topics, (oldId, newId) => {
    for (const a of chunkResult.assignments) {
      if (a.topic_id === oldId) a.topic_id = newId;
    }
  });
  saveChunkResult(conversation, chunkResult);
  await writeJson(join(args["working_dir"], "conversation.json"), conversation);

  if (chunkResult.new_topics.length > 0) {
    const potentialPath = join(args["working_dir"], "potential_topics.json");
    const existing = await readJson(PotentialTopicsSchema, potentialPath);
    const merged = appendNewTopics(existing.topics, chunkResult.new_topics);
    await writeJson(potentialPath, { topics: merged });
  }

  deleteFile(args["input_file"]);

  outputResult({
    status: "Ok",
    turns_saved: chunkResult.turns.length,
    new_topics: chunkResult.new_topics.length,
  });
}

if (import.meta.main) {
  main();
}
