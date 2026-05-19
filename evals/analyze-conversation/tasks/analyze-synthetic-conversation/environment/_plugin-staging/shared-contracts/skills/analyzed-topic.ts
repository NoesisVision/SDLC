import { z } from "zod";
import {
  DecisionContextSchema,
  DecisionOptionSchema,
  DecisionStatusSchema,
} from "../decision.js";
import { SourceContentRefSchema } from "../source-content.js";
import { newUuid } from "../uuid.js";

export const AnalyzedDecisionSchema = z.object({
  id: z.string().default(() => newUuid()),
  title: z.string(),
  status: DecisionStatusSchema,
  context: DecisionContextSchema,
  decision: DecisionOptionSchema,
  alternative_options: z.array(DecisionOptionSchema),
});
export type AnalyzedDecision = z.infer<typeof AnalyzedDecisionSchema>;

export const AnalyzedTopicSchema = z.object({
  id: z.string(),
  parent_id: z.string().nullable().default(null),
  is_new: z.boolean().default(false),
  title: z.string(),
  short_summary: z.string(),
  long_summary: z.string(),
  items: z.array(SourceContentRefSchema),
  decisions: z.array(AnalyzedDecisionSchema).default(() => []),
  reviewed: z.boolean().default(false),
  decisions_extracted: z.boolean().default(false),
});
export type AnalyzedTopic = z.infer<typeof AnalyzedTopicSchema>;
