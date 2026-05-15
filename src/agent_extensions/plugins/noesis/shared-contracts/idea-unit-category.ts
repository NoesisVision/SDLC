import { z } from "zod";

export const IdeaUnitCategory = z.enum([
  "Information",
  "Position",
  "Argument",
  "Decision",
  "Irrelevant",
]);
export type IdeaUnitCategory = z.infer<typeof IdeaUnitCategory>;

export function isIrrelevant(categories: IdeaUnitCategory[]): boolean {
  return categories.length === 1 && categories[0] === "Irrelevant";
}
