import { z } from "zod";
import { SourceContentRefSchema } from "./source-content.js";

export const DecisionStatusSchema = z.enum(["accepted", "proposed"]);
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

export const DecisionContextSchema = z.object({
  text: z.string(),
  text_locked: z.boolean().default(false),
  supporting_content: z.array(SourceContentRefSchema),
});
export type DecisionContext = z.infer<typeof DecisionContextSchema>;

export const DecisionOptionSchema = z.object({
  text: z.string(),
  text_locked: z.boolean().default(false),
  rationale: z.string(),
  rationale_locked: z.boolean().default(false),
  supporting_content: z.array(SourceContentRefSchema),
});
export type DecisionOption = z.infer<typeof DecisionOptionSchema>;

export const DecisionFileSchema = z.object({
  id: z.string(),
  topic_id: z.string(),
  title: z.string(),
  title_locked: z.boolean().default(false),
  status: DecisionStatusSchema,
  status_locked: z.boolean().default(false),
  context: DecisionContextSchema,
  decision: DecisionOptionSchema,
  alternative_options: z.array(DecisionOptionSchema),
  is_stale: z.boolean().default(false),
});
export type DecisionFile = z.infer<typeof DecisionFileSchema>;
