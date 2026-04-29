import { z } from "zod";
import {
  IdeaUnitRefSchema,
  TurnSchema,
} from "./conversation.js";
import {
  DocumentFragmentRefSchema,
  DocumentFragmentSchema,
  SectionNodeSchema,
} from "./documents.js";
import {
  DecisionContextSchema,
  DecisionOptionSchema,
  DecisionStatusSchema,
} from "./topics.js";

export const ConversationSidecarSchema = z.object({
  conversation_id: z.string(),
  time: z.string(),
  main_topic: z.string(),
  turns: z.array(TurnSchema),
  md_sha: z.string().optional(),
  edited_by_user: z.boolean().optional(),
});
export type ConversationSidecar = z.infer<typeof ConversationSidecarSchema>;

export const DocumentSidecarSchema = z.object({
  document_id: z.string(),
  title: z.string(),
  date: z.string(),
  fragments: z.array(DocumentFragmentSchema),
  section_tree: z.array(SectionNodeSchema),
  md_sha: z.string().optional(),
  edited_by_user: z.boolean().optional(),
});
export type DocumentSidecar = z.infer<typeof DocumentSidecarSchema>;

export const TopicFileItemSchema = z.union([
  IdeaUnitRefSchema,
  DocumentFragmentRefSchema,
]);
export type TopicFileItem = z.infer<typeof TopicFileItemSchema>;

export const TopicFileSchema = z.object({
  id: z.string(),
  parent_id: z.string().nullable().default(null),
  title: z.string(),
  short_summary: z.string(),
  long_summary: z.string(),
  items: z.array(TopicFileItemSchema),
  reviewed: z.boolean().default(false),
  decisions_extracted: z.boolean().default(false),
  edited_by_user: z.boolean().optional(),
});
export type TopicFile = z.infer<typeof TopicFileSchema>;

export const DecisionFileSchema = z.object({
  id: z.string(),
  topic_id: z.string(),
  title: z.string(),
  status: DecisionStatusSchema,
  referenced_items: z.array(TopicFileItemSchema),
  context: DecisionContextSchema,
  decision: DecisionOptionSchema,
  alternative_options: z.array(DecisionOptionSchema),
  edited_by_user: z.boolean().optional(),
});
export type DecisionFile = z.infer<typeof DecisionFileSchema>;
