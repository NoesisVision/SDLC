import { z } from "zod";
import { IdeaUnitRefSchema, TurnSchema } from "./conversation.js";
import {
  DocumentFragmentRefSchema,
  DocumentFragmentSchema,
  SectionNodeSchema,
} from "./documents.js";
import { DecisionStatusSchema } from "./topics.js";

export const TopicItemRefNewSchema = z.union([
  IdeaUnitRefSchema,
  DocumentFragmentRefSchema,
]);
export type TopicItemRefNew = z.infer<typeof TopicItemRefNewSchema>;

export const ConversationFileNewSchema = z.object({
  conversation_id: z.string(),
  time: z.string(),
  main_topic: z.string(),
  turns: z.array(TurnSchema),
});
export type ConversationFileNew = z.infer<typeof ConversationFileNewSchema>;

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
  items: z.array(TopicItemRefNewSchema),
  reviewed: z.boolean().default(false),
  decisions_extracted: z.boolean().default(false),
  is_stale: z.boolean().default(false),
});
export type TopicFileNew = z.infer<typeof TopicFileNewSchema>;

export const DecisionContextNewSchema = z.object({
  text: z.string(),
  text_locked: z.boolean().default(false),
  supporting_item_indices: z.array(z.number().int().nonnegative()),
});
export type DecisionContextNew = z.infer<typeof DecisionContextNewSchema>;

export const DecisionOptionNewSchema = z.object({
  text: z.string(),
  text_locked: z.boolean().default(false),
  rationale: z.string(),
  rationale_locked: z.boolean().default(false),
  supporting_item_indices: z.array(z.number().int().nonnegative()),
});
export type DecisionOptionNew = z.infer<typeof DecisionOptionNewSchema>;

export const DecisionFileNewSchema = z
  .object({
    id: z.string(),
    topic_id: z.string(),
    title: z.string(),
    title_locked: z.boolean().default(false),
    status: DecisionStatusSchema,
    status_locked: z.boolean().default(false),
    referenced_items: z.array(TopicItemRefNewSchema),
    context: DecisionContextNewSchema,
    decision: DecisionOptionNewSchema,
    alternative_options: z.array(DecisionOptionNewSchema),
    is_stale: z.boolean().default(false),
  })
  .superRefine((decision, ctx) => {
    const max = decision.referenced_items.length;
    function checkIndices(indices: number[], path: (string | number)[]): void {
      for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        if (idx >= max) {
          ctx.addIssue({
            code: "custom",
            path: [...path, i],
            message:
              `supporting_item_indices[${i}] = ${idx} is out of range; ` +
              `referenced_items has length ${max}`,
          });
        }
      }
    }
    checkIndices(decision.context.supporting_item_indices, [
      "context",
      "supporting_item_indices",
    ]);
    checkIndices(decision.decision.supporting_item_indices, [
      "decision",
      "supporting_item_indices",
    ]);
    for (let i = 0; i < decision.alternative_options.length; i++) {
      checkIndices(decision.alternative_options[i].supporting_item_indices, [
        "alternative_options",
        i,
        "supporting_item_indices",
      ]);
    }
  });
export type DecisionFileNew = z.infer<typeof DecisionFileNewSchema>;
