import { z } from "zod";
import { IdeaUnitCategory } from "./idea-unit-category.js";

export { IdeaUnitCategory } from "./idea-unit-category.js";

export const IdeaUnitSchema = z.object({
  index: z.int(),
  sentences: z.array(z.string()),
  categories: z.array(IdeaUnitCategory),
});
export type IdeaUnit = z.infer<typeof IdeaUnitSchema>;

export const IdeaUnitRefSchema = z.object({
  type: z.literal("idea_unit_ref"),
  conversation_id: z.string(),
  turn_index: z.int(),
  idea_unit_index: z.int(),
  source_sha: z
    .string()
    .optional()
    .describe(
      "SHA-256 of the conversation JSON file at ref-creation time. Used to detect stale references when the conversation file changes.",
    ),
});
export type IdeaUnitRef = z.infer<typeof IdeaUnitRefSchema>;

export const TurnSchema = z.object({
  index: z.int(),
  speaker: z.string(),
  time: z.string(),
  idea_units: z.array(IdeaUnitSchema),
});
export type Turn = z.infer<typeof TurnSchema>;

export const ConversationSchema = z.object({
  conversation_id: z.string(),
  time: z.string(),
  main_topic: z.string(),
  turns: z.array(TurnSchema),
});
export type Conversation = z.infer<typeof ConversationSchema>;
