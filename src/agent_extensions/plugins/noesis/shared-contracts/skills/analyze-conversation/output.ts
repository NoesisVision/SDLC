import { z } from "zod";
import { ConversationSchema } from "../../conversation.js";
import { AnalyzedTopicSchema } from "../analyzed-topic.js";

const AnalyzedConversationSchema = ConversationSchema.extend({
  topics: z.array(AnalyzedTopicSchema),
});

export const AnalyzeConversationOutputSchema = z.object({
  conversation: AnalyzedConversationSchema,
});
export type AnalyzeConversationOutput = z.infer<
  typeof AnalyzeConversationOutputSchema
>;
