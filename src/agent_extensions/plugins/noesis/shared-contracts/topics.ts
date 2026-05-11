import { z } from "zod";
import { IdeaUnitRefSchema, type IdeaUnitRef } from "./conversation.js";
import { DocumentFragmentRefSchema, type DocumentFragmentRef } from "./documents.js";
import { newUuid } from "./uuid.js";

export const TopicItemSchema = z.union([
  z.lazy(() => IdeaUnitRefSchema),
  DocumentFragmentRefSchema,
]);
export type TopicItem = IdeaUnitRef | DocumentFragmentRef;

export const DecisionContextSchema = z.object({
  text: z.string(),
  supporting_item_indices: z.array(z.number().int().nonnegative()),
});
export type DecisionContext = z.infer<typeof DecisionContextSchema>;

export const DecisionOptionSchema = z.object({
  text: z.string(),
  rationale: z.string(),
  supporting_item_indices: z.array(z.number().int().nonnegative()),
});
export type DecisionOption = z.infer<typeof DecisionOptionSchema>;

export const DecisionStatusSchema = z.enum(["accepted", "proposed"]);
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

export const DecisionSchema = z
  .object({
    id: z.string().default(() => newUuid()),
    title: z.string(),
    status: DecisionStatusSchema,
    referenced_items: z.array(TopicItemSchema),
    context: DecisionContextSchema,
    decision: DecisionOptionSchema,
    alternative_options: z.array(DecisionOptionSchema),
    edited_by_user: z.boolean().optional(),
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
    const used = new Set<number>();
    for (const idx of decision.context.supporting_item_indices) used.add(idx);
    for (const idx of decision.decision.supporting_item_indices) used.add(idx);
    for (const alt of decision.alternative_options) {
      for (const idx of alt.supporting_item_indices) used.add(idx);
    }
    for (let i = 0; i < decision.referenced_items.length; i++) {
      if (!used.has(i)) {
        ctx.addIssue({
          code: "custom",
          path: ["referenced_items", i],
          message:
            `referenced_items[${i}] is not cited by any slot; ` +
            `remove it or reference it from context / decision / an alternative_option.`,
        });
      }
    }
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
  edited_by_user: z.boolean().optional(),
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

