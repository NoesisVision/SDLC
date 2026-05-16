import { z } from "zod";
import { SourceContentRefSchema } from "./source-content.js";

export const TopicFileSchema = z.object({
  id: z.string(),
  parent_id: z.string().nullable().default(null),
  title: z.string(),
  title_locked: z.boolean().default(false),
  short_summary: z.string(),
  short_summary_locked: z.boolean().default(false),
  long_summary: z.string(),
  long_summary_locked: z.boolean().default(false),
  items: z.array(SourceContentRefSchema),
  reviewed: z.boolean().default(false),
  decisions_extracted: z.boolean().default(false),
  is_stale: z.boolean().default(false),
});
export type TopicFile = z.infer<typeof TopicFileSchema>;
