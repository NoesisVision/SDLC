import type {
  DocumentAnalysis,
  DocumentFragment,
} from "../../shared-contracts/document-analysis.js";
import type { IdeaUnitCategory } from "../../shared-contracts/conversation.js";

export function applyFragmentCategories(
  analysis: DocumentAnalysis,
  fragmentCategories: Array<{ fragment_index: number; categories: IdeaUnitCategory[] }>,
): void {
  const map = new Map<number, DocumentFragment>(
    analysis.fragments.map((f) => [f.index, f]),
  );
  for (const entry of fragmentCategories) {
    const fragment = map.get(entry.fragment_index);
    if (fragment === undefined) continue;
    fragment.categories = entry.categories;
  }
}

export function findFragmentOrFail(
  analysis: DocumentAnalysis,
  fragmentIndex: number,
): DocumentFragment {
  const fragment = analysis.fragments.find((f) => f.index === fragmentIndex);
  if (fragment === undefined) {
    throw new Error(`Fragment not found: ${fragmentIndex}`);
  }
  return fragment;
}
