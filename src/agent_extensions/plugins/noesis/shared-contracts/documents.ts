import { z } from "zod";

export const DocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  date: z.string(),
  content: z.string(),
});
export type Document = z.infer<typeof DocumentSchema>;

export const DocumentFragmentRefSchema = z.object({
  type: z.literal("document_fragment_ref"),
  document_id: z.string(),
  start_offset: z.int(),
  end_offset: z.int(),
});
export type DocumentFragmentRef = z.infer<typeof DocumentFragmentRefSchema>;
