import { z } from "zod";
import { DecisionStatusSchema } from "../decision-status.js";
import { SourceContentRefSchema } from "../source-content.js";
import { newUuid } from "../uuid.js";

export const DecisionContextSchema = z.object({
  text: z.string(),
  supporting_content: z.array(SourceContentRefSchema),
});
export type DecisionContext = z.infer<typeof DecisionContextSchema>;

export const DecisionOptionSchema = z.object({
  text: z.string(),
  rationale: z.string(),
  supporting_content: z.array(SourceContentRefSchema),
});
export type DecisionOption = z.infer<typeof DecisionOptionSchema>;

export const DecisionSchema = z.object({
  id: z.string().default(() => newUuid()),
  title: z.string(),
  status: DecisionStatusSchema,
  context: DecisionContextSchema,
  decision: DecisionOptionSchema,
  alternative_options: z.array(DecisionOptionSchema),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const AnalyzedTopicSchema = z.object({
  id: z.string(),
  parent_id: z.string().nullable().default(null),
  is_new: z.boolean().default(false),
  title: z.string(),
  short_summary: z.string(),
  long_summary: z.string(),
  items: z.array(SourceContentRefSchema),
  decisions: z.array(DecisionSchema).default(() => []),
  reviewed: z.boolean().default(false),
  decisions_extracted: z.boolean().default(false),
});
export type AnalyzedTopic = z.infer<typeof AnalyzedTopicSchema>;
