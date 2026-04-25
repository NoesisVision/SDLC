import { z } from "zod";

export const CONVERSATION_ID_PATTERN =
  /^<!--\s*conversation_id:\s*([\w-]+)\s*-->/;

export const RawTurnSchema = z.object({
  speaker: z.string(),
  time: z.string(),
  sentences: z.array(z.string()),
});
export type RawTurn = z.infer<typeof RawTurnSchema>;

export const RawTranscriptSchema = z.object({
  conversation_id: z.string(),
  turns: z.array(RawTurnSchema),
});
export type RawTranscript = z.infer<typeof RawTranscriptSchema>;
