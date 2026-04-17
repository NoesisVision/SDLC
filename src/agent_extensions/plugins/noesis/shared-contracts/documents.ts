import { z } from "zod";

export const DocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  date: z.string(),
  content: z.string(),
});
export type Document = z.infer<typeof DocumentSchema>;
