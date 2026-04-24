import { randomUUID } from "crypto";
import { z } from "zod";
import { IdeaUnitRefSchema, type IdeaUnitRef } from "./conversation.js";
import { DocumentFragmentRefSchema, type DocumentFragmentRef } from "./documents.js";

export const TopicItemSchema = z.union([
  z.lazy(() => IdeaUnitRefSchema),
  DocumentFragmentRefSchema,
]);
export type TopicItem = IdeaUnitRef | DocumentFragmentRef;

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

