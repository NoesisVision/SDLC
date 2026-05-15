import { z } from "zod";
import { IdeaUnitCategory } from "./idea-unit-category.js";

export const DocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  date: z.string(),
  content: z.string(),
});
export type Document = z.infer<typeof DocumentSchema>;

export const DocumentFragmentRefSchema = z.object({
  type: z.literal("document_fragment_ref"),
  document_id: z.string(),
  start_offset: z.int(),
  end_offset: z.int(),
  source_sha: z
    .string()
    .optional()
    .describe(
      "SHA-256 of the document JSON file at ref-creation time. Used to detect stale references when fragments shift.",
    ),
});
export type DocumentFragmentRef = z.infer<typeof DocumentFragmentRefSchema>;

export const DocumentFragmentKindSchema = z.enum([
  "paragraph",
  "list",
  "list_item",
  "code_block",
  "table",
  "blockquote",
  "structural",
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

export function formatSectionTreeMarkdown(tree: SectionNode[]): string {
  const lines: string[] = ["# Section tree", ""];
  const walk = (node: SectionNode) => {
    const prefix = "  ".repeat(node.level - 1);
    const fragmentCount = node.fragment_indices.length;
    lines.push(
      `${prefix}- ${"#".repeat(node.level)} ${node.title} _(${fragmentCount} fragments)_`,
    );
    for (const child of node.children) {
      walk(child);
    }
  };
  for (const root of tree) {
    walk(root);
  }
  return lines.join("\n");
}
