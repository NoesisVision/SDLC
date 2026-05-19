import { z } from "zod";

export const IdeaUnitCategory = z.enum([
  "Information",
  "Position",
  "Argument",
  "Decision",
  "Irrelevant",
]);
export type IdeaUnitCategory = z.infer<typeof IdeaUnitCategory>;
