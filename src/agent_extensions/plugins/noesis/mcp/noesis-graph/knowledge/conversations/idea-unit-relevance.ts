import type { IdeaUnitCategory } from "../../../../shared-contracts/idea-unit-category.js";

export function isIrrelevant(categories: IdeaUnitCategory[]): boolean {
  return categories.length === 1 && categories[0] === "Irrelevant";
}
