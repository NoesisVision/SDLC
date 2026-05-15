import { z } from "zod";
import { DecisionStatusSchema } from "./decision-status.js";
import {
  DocumentFragmentSchema,
  SectionNodeSchema,
} from "./documents.js";
import { SourceContentRefSchema } from "./source-content.js";

export const DocumentFileNewSchema = z.object({
  document_id: z.string(),
  title: z.string(),
  date: z.string(),
  content: z.string(),
  fragments: z.array(DocumentFragmentSchema),
  section_tree: z.array(SectionNodeSchema),
});
export type DocumentFileNew = z.infer<typeof DocumentFileNewSchema>;

export const TopicFileNewSchema = z.object({
  id: z.string(),
  parent_id: z.string().nullable().default(null),
  title: z.string(),
  title_locked: z.boolean().default(false),
  short_summary: z.string(),
  short_summary_locked: z.boolean().default(false),
  long_summary: z.string(),
  long_summary_locked: z.boolean().default(false),
  items: z.array(SourceContentRefSchema),
  reviewed: z.boolean().default(false),
  decisions_extracted: z.boolean().default(false),
  is_stale: z.boolean().default(false),
});
export type TopicFileNew = z.infer<typeof TopicFileNewSchema>;

export const DecisionContextNewSchema = z.object({
  text: z.string(),
  text_locked: z.boolean().default(false),
  supporting_content: z.array(SourceContentRefSchema),
});
export type DecisionContextNew = z.infer<typeof DecisionContextNewSchema>;

export const DecisionOptionNewSchema = z.object({
  text: z.string(),
  text_locked: z.boolean().default(false),
  rationale: z.string(),
  rationale_locked: z.boolean().default(false),
  supporting_content: z.array(SourceContentRefSchema),
});
export type DecisionOptionNew = z.infer<typeof DecisionOptionNewSchema>;

export const DecisionFileNewSchema = z.object({
  id: z.string(),
  topic_id: z.string(),
  title: z.string(),
  title_locked: z.boolean().default(false),
  status: DecisionStatusSchema,
  status_locked: z.boolean().default(false),
  context: DecisionContextNewSchema,
  decision: DecisionOptionNewSchema,
  alternative_options: z.array(DecisionOptionNewSchema),
  is_stale: z.boolean().default(false),
});
export type DecisionFileNew = z.infer<typeof DecisionFileNewSchema>;
