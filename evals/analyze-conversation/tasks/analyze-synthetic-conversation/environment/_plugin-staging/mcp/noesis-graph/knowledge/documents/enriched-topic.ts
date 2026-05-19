import { z } from "zod";
import { IdeaUnitCategory } from "../../../../shared-contracts/idea-unit-category.js";
import {
  DocumentFragmentKindSchema,
  type DocumentFragment,
} from "../../../../shared-contracts/document.js";

export const FragmentDetailSchema = z.object({
  document_id: z.string(),
  fragment_index: z.int(),
  start_offset: z.int(),
  end_offset: z.int(),
  section_path: z.array(z.string()),
  kind: DocumentFragmentKindSchema,
  text: z.string(),
  categories: z.array(IdeaUnitCategory),
});
export type FragmentDetail = z.infer<typeof FragmentDetailSchema>;

export const EnrichedDocumentTopicSchema = z.object({
  id: z.string(),
  title: z.string(),
  short_summary: z.string(),
  long_summary: z.string(),
  document_id: z.string(),
  fragments: z.array(FragmentDetailSchema),
});
export type EnrichedDocumentTopic = z.infer<typeof EnrichedDocumentTopicSchema>;

export function buildFragmentMap(
  fragments: DocumentFragment[],
): Map<number, DocumentFragment> {
  return new Map(fragments.map((f) => [f.index, f]));
}

export function isIrrelevantFragment(
  categories: DocumentFragment["categories"],
): boolean {
  return categories.length === 1 && categories[0] === "Irrelevant";
}

export function resolveFragmentDetail(
  documentId: string,
  fragmentIndex: number,
  fragmentMap: Map<number, DocumentFragment>,
): FragmentDetail | null {
  const fragment = fragmentMap.get(fragmentIndex);
  if (fragment === undefined) return null;
  return {
    document_id: documentId,
    fragment_index: fragment.index,
    start_offset: fragment.start_offset,
    end_offset: fragment.end_offset,
    section_path: fragment.section_path,
    kind: fragment.kind,
    text: fragment.text,
    categories: fragment.categories,
  };
}

export function formatEnrichedDocumentTopicMarkdown(
  topic: EnrichedDocumentTopic,
): string {
  const lines: string[] = [];
  lines.push(`# ${topic.title}`);
  lines.push(`- **ID:** ${topic.id}`);
  lines.push(`- **Document:** ${topic.document_id}`);
  lines.push(`- **Summary:** ${topic.short_summary}`);
  if (topic.long_summary) {
    lines.push(`- **Long summary:** ${topic.long_summary}`);
  }
  lines.push("");
  lines.push("## Fragments");
  lines.push("");

  for (const f of topic.fragments) {
    const cats = f.categories.join(", ");
    const sectionPath =
      f.section_path.length > 0 ? f.section_path.join(" / ") : "(no section)";
    lines.push(
      `### [F${f.fragment_index}] ${sectionPath} — ${f.kind} [${cats}]`,
    );
    lines.push(f.text);
    lines.push("");
  }

  return lines.join("\n");
}
