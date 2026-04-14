import { z } from "zod";
import { TurnSchema } from "../conversation/types.js";
import { DecisionSchema, TopicSchema } from "../topics/types.js";

export const ConversationSummarySchema = z.object({
  conversation_id: z.string(),
  time: z.string(),
  main_topic: z.string(),
  turns: z.array(TurnSchema),
});
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

export const TopicOverviewSchema = z.object({
  id: z.string(),
  title: z.string(),
  short_summary: z.string(),
  long_summary: z.string(),
  has_subtopics: z.boolean(),
  path: z.array(z.string()),
});
export type TopicOverview = z.infer<typeof TopicOverviewSchema>;

export const KnowledgeGraphSchema = z.object({
  conversations: z.array(ConversationSummarySchema),
  topics: z.array(TopicSchema),
  decisions: z.array(DecisionSchema),
});
export type KnowledgeGraph = z.infer<typeof KnowledgeGraphSchema>;
