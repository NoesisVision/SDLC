import { z } from "zod";
import { ConversationSchema } from "../../conversation.js";
import { PotentialTopicsSchema, TopicSchema } from "../../topics.js";

const AnalyzedConversationSchema = ConversationSchema.extend({
  topics: z.array(TopicSchema),
});

export const AnalyzeConversationOutputSchema = z.object({
  conversation: AnalyzedConversationSchema,
  potential_topics: PotentialTopicsSchema,
});
export type AnalyzeConversationOutput = z.infer<
  typeof AnalyzeConversationOutputSchema
>;
