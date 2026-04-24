import { z } from "zod";
import { IdeaUnitCategory } from "./conversation.js";
import { TopicSchema } from "./topics.js";

export const DocumentFragmentKindSchema = z.enum([
  "paragraph",
  "list",
  "code_block",
  "table",
  "blockquote",
]);
export type DocumentFragmentKind = z.infer<typeof DocumentFragmentKindSchema>;

export const DocumentFragmentSchema = z.object({
  index: z.int(),
  start_offset: z.int(),
  end_offset: z.int(),
  section_path: z.array(z.string()),
  kind: DocumentFragmentKindSchema,
  text: z.string(),
  categories: z.array(IdeaUnitCategory).default(() => []),
});
export type DocumentFragment = z.infer<typeof DocumentFragmentSchema>;

export const SectionNodeSchema: z.ZodType<SectionNode> = z.lazy(() =>
  z.object({
    level: z.int(),
    title: z.string(),
    path: z.array(z.string()),
    fragment_indices: z.array(z.int()),
    children: z.array(SectionNodeSchema),
  }),
);
export interface SectionNode {
  level: number;
  title: string;
  path: string[];
  fragment_indices: number[];
  children: SectionNode[];
}

export const DecisionSlotSchema = z.enum(["context", "decision", "alternative"]);
export type DecisionSlot = z.infer<typeof DecisionSlotSchema>;

export const AttachToDecisionSchema = z.object({
  decision_id: z.string(),
  slot: DecisionSlotSchema,
  alternative_index: z.int().nullable().default(null),
  fragment_indices: z.array(z.int()),
});
export type AttachToDecision = z.infer<typeof AttachToDecisionSchema>;

export const DocumentAnalysisSchema = z.object({
  document_id: z.string(),
  document_title: z.string(),
  document_date: z.string(),
  fragments: z.array(DocumentFragmentSchema),
  section_tree: z.array(SectionNodeSchema),
  topics: z.array(z.lazy(() => TopicSchema)),
  decision_attachments: z.array(AttachToDecisionSchema).default(() => []),
  design_doc_id: z.string().nullable().default(null),
  design_doc_title: z.string().nullable().default(null),
  design_doc_extracted: z.boolean().default(false),
});
export type DocumentAnalysis = z.infer<typeof DocumentAnalysisSchema>;

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

// --- Domain functions ---

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
    const sectionPath = f.section_path.length > 0 ? f.section_path.join(" / ") : "(no section)";
    lines.push(
      `### [F${f.fragment_index}] ${sectionPath} — ${f.kind} [${cats}]`,
    );
    lines.push(f.text);
    lines.push("");
  }

  return lines.join("\n");
}

export function formatSectionTreeMarkdown(tree: SectionNode[]): string {
  const lines: string[] = ["# Section tree", ""];
  const walk = (node: SectionNode) => {
    const prefix = "  ".repeat(node.level - 1);
    const fragmentCount = node.fragment_indices.length;
    lines.push(`${prefix}- ${"#".repeat(node.level)} ${node.title} _(${fragmentCount} fragments)_`);
    for (const child of node.children) {
      walk(child);
    }
  };
  for (const root of tree) {
    walk(root);
  }
  return lines.join("\n");
}
