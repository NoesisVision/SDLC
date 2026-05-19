import { z } from "zod";
import { DocumentFileSchema } from "../../document.js";
import { AnalyzedTopicSchema } from "../analyzed-topic.js";

export const DecisionSlotSchema = z.enum([
  "context",
  "decision",
  "alternative",
]);
export type DecisionSlot = z.infer<typeof DecisionSlotSchema>;

export const AttachToDecisionSchema = z.object({
  decision_id: z.string(),
  slot: DecisionSlotSchema,
  alternative_index: z.int().nullable().default(null),
  fragment_indices: z.array(z.int()),
});
export type AttachToDecision = z.infer<typeof AttachToDecisionSchema>;

export const AnalyzeDesignDraftOutputSchema = z.object({
  document: DocumentFileSchema,
  topics: z.array(AnalyzedTopicSchema),
  decision_attachments: z.array(AttachToDecisionSchema).default(() => []),
  design_doc_id: z.string().nullable().default(null),
  design_doc_title: z.string().nullable().default(null),
  design_doc_extracted: z.boolean().default(false),
});
export type AnalyzeDesignDraftOutput = z.infer<
  typeof AnalyzeDesignDraftOutputSchema
>;
