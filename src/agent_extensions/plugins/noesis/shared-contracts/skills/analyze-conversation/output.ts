import { z } from "zod";
import { ConversationSchema } from "../../conversation.js";
import { PotentialTopicsSchema } from "../../topics.js";

export const AnalyzeConversationOutputSchema = z.object({
  conversation: ConversationSchema,
  potential_topics: PotentialTopicsSchema,
});
export type AnalyzeConversationOutput = z.infer<
  typeof AnalyzeConversationOutputSchema
>;
