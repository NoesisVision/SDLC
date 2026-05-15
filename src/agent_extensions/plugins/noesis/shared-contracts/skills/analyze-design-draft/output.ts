import { z } from "zod";
import { IdeaUnitCategory } from "../../idea-unit-category.js";
import {
  DocumentFragmentKindSchema,
  DocumentFragmentSchema,
  DocumentSchema,
  SectionNodeSchema,
  buildFragmentMap,
  type DocumentFragment,
} from "../../documents.js";
import { AnalyzedTopicSchema } from "../analyzed-topic.js";

export const DecisionSlotSchema = z.enum([
  "context",
  "decision",
  "alternative",
]);
export type DecisionSlot = z.infer<typeof DecisionSlotSchema>;

export const AttachToDecisionSchema = z.object({
  decision_id: z.string(),
  slot: DecisionSlotSchema,
  alternative_index: z.int().nullable().default(null),
  fragment_indices: z.array(z.int()),
});
export type AttachToDecision = z.infer<typeof AttachToDecisionSchema>;

export const AnalyzeDesignDraftOutputSchema = z.object({
  document: DocumentSchema,
  fragments: z.array(DocumentFragmentSchema),
  section_tree: z.array(SectionNodeSchema),
  topics: z.array(AnalyzedTopicSchema),
  decision_attachments: z.array(AttachToDecisionSchema).default(() => []),
  design_doc_id: z.string().nullable().default(null),
  design_doc_title: z.string().nullable().default(null),
  design_doc_extracted: z.boolean().default(false),
});
export type AnalyzeDesignDraftOutput = z.infer<
  typeof AnalyzeDesignDraftOutputSchema
>;

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
export type EnrichedDocumentTopic = z.infer<
  typeof EnrichedDocumentTopicSchema
>;

// --- Domain functions ---

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

export { buildFragmentMap };
