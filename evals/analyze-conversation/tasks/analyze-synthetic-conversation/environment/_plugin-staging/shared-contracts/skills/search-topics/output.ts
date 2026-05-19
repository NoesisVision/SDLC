import { z } from "zod";

export const TopicSweetSpotSchema = z.object({
  id: z.string(),
  title: z.string(),
  path: z.array(z.string()),
  long_summary: z.string(),
});
export type TopicSweetSpot = z.infer<typeof TopicSweetSpotSchema>;

export const SearchTopicsOutputSchema = z.object({
  query: z.string(),
  sweet_spots: z.array(TopicSweetSpotSchema),
});
export type SearchTopicsOutput = z.infer<typeof SearchTopicsOutputSchema>;
