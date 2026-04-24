import { randomUUID } from "crypto";
import { z } from "zod";

export const ConversationIdeaUnitSchema = z.object({
  type: z.literal("conversation_idea_unit"),
  conversation_id: z.string(),
  turn_index: z.int(),
  idea_unit_index: z.int(),
});
export type ConversationIdeaUnit = z.infer<typeof ConversationIdeaUnitSchema>;

export const DocumentFragmentSchema = z.object({
  type: z.literal("document_fragment"),
  document_id: z.string(),
  start_offset: z.int(),
  end_offset: z.int(),
});
export type DocumentFragment = z.infer<typeof DocumentFragmentSchema>;

export const TopicItemSchema = z.discriminatedUnion("type", [
  ConversationIdeaUnitSchema,
  DocumentFragmentSchema,
]);
export type TopicItem = z.infer<typeof TopicItemSchema>;

export const DecisionContextSchema = z.object({
  text: z.string(),
  supporting_items: z.array(TopicItemSchema),
});
export type DecisionContext = z.infer<typeof DecisionContextSchema>;

export const DecisionOptionSchema = z.object({
  text: z.string(),
  rationale: z.string(),
  supporting_items: z.array(TopicItemSchema),
});
export type DecisionOption = z.infer<typeof DecisionOptionSchema>;

export const DecisionStatusSchema = z.enum(["accepted", "proposed"]);
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

export const DecisionSchema = z.object({
  id: z.string().default(() => randomUUID()),
  title: z.string(),
  status: DecisionStatusSchema,
  context: DecisionContextSchema,
  decision: DecisionOptionSchema,
  alternative_options: z.array(DecisionOptionSchema),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const TopicSchema = z.object({
  id: z.string(),
  title: z.string(),
  short_summary: z.string(),
  long_summary: z.string(),
  items: z.array(TopicItemSchema),
  decisions: z.array(DecisionSchema).default(() => []),
  reviewed: z.boolean().default(false),
  decisions_extracted: z.boolean().default(false),
});
export type Topic = z.infer<typeof TopicSchema>;

export const TopicOverviewSchema = z.object({
  id: z.string(),
  title: z.string(),
  short_summary: z.string(),
  long_summary: z.string(),
  has_subtopics: z.boolean(),
  path: z.array(z.string()),
});
export type TopicOverview = z.infer<typeof TopicOverviewSchema>;

export const PotentialTopicSchema = z.object({
  id: z.string(),
  title: z.string(),
  short_summary: z.string(),
  path: z.array(z.string()),
  is_new: z.boolean().default(false),
  parent_id: z.string().nullable().default(null),
});
export type PotentialTopic = z.infer<typeof PotentialTopicSchema>;

export const PotentialTopicsSchema = z.object({
  topics: z.array(PotentialTopicSchema),
});
export type PotentialTopics = z.infer<typeof PotentialTopicsSchema>;

export const IdeaUnitTopicAssignmentSchema = z.object({
  turn_index: z.int(),
  idea_unit_index: z.int(),
  topic_id: z.string(),
});
export type IdeaUnitTopicAssignment = z.infer<
  typeof IdeaUnitTopicAssignmentSchema
>;

export const IdeaUnitReassignmentSchema = z.object({
  turn_index: z.int(),
  idea_unit_index: z.int(),
  new_topic_id: z.string(),
});
export type IdeaUnitReassignment = z.infer<typeof IdeaUnitReassignmentSchema>;

export const DecisionExtractionResultSchema = z.object({
  topic_id: z.string(),
  decisions: z.array(DecisionSchema),
});
export type DecisionExtractionResult = z.infer<
  typeof DecisionExtractionResultSchema
>;

// --- Domain functions ---

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

