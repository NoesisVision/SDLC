import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { z } from "zod";
import { exitError, outputResult, parseArgs, requireFile } from "../io.js";
import {
  DocumentAnalysisSchema,
  formatSectionTreeMarkdown,
  type DocumentAnalysis,
} from "../../shared-contracts/document-analysis.js";
import { DocumentSchema } from "../../shared-contracts/documents.js";
import { fragmentMarkdown } from "./fragment-markdown.js";
import { chunkFragments, type ChunkInfo } from "./chunk-fragments.js";
import { getDocumentWorkingDir } from "./working-dir.js";

const DEFAULT_TOKEN_LIMIT = 8000;
const DOCUMENT_ID_PATTERN = /^<!--\s*document_id:\s*([\w-]+)\s*-->/;

const ChunkInfoSchema = z.object({
  chunk_id: z.number(),
  file: z.string(),
  fragment_indices: z.array(z.number()),
  num_fragments: z.number(),
  section_paths: z.array(z.array(z.string())),
});

const PrepareResultSchema = z.object({
  status: z.literal("Ok"),
  working_dir: z.string(),
  document_id: z.string(),
  design_doc_id: z.string().nullable(),
  design_doc_title: z.string().nullable(),
  section_tree_path: z.string(),
  document_path: z.string(),
  analysis_path: z.string(),
  chunks: z.array(ChunkInfoSchema),
});
type PrepareResult = z.infer<typeof PrepareResultSchema>;

// --- Public functions ---

export function initAnalysis(
  workingDir: string,
  analysis: DocumentAnalysis,
): string {
  const path = join(workingDir, "analysis.json");
  DocumentAnalysisSchema.parse(analysis);
  writeFileSync(path, JSON.stringify(analysis, null, 2), "utf-8");
  return path;
}

export function initDocument(
  workingDir: string,
  documentId: string,
  title: string,
  date: string,
  content: string,
): string {
  const document = { id: documentId, title, date, content };
  DocumentSchema.parse(document);
  const path = join(workingDir, "document.json");
  writeFileSync(path, JSON.stringify(document, null, 2), "utf-8");
  return path;
}

export function prepareDocumentAnalysis(
  documentPath: string,
  title: string,
  date: string,
  options: {
    designDocId: string | null;
    designDocTitle: string | null;
    tokenLimit?: number;
  },
): PrepareResult {
  const workingDir = getDocumentWorkingDir(documentPath);
  mkdirSync(workingDir, { recursive: true });

  const documentId = resolveDocumentId(documentPath);
  const content = readFileSync(documentPath, "utf-8");
  const resolvedTitle = title.trim() !== "" ? title : extractTitleFromContent(content) ?? defaultTitle(documentPath);

  const documentJsonPath = initDocument(workingDir, documentId, resolvedTitle, date, content);

  const { fragments, section_tree } = fragmentMarkdown(content);

  const analysis: DocumentAnalysis = {
    document_id: documentId,
    document_title: resolvedTitle,
    document_date: date,
    fragments,
    section_tree,
    topics: [],
    decision_attachments: [],
    design_doc_id: options.designDocId,
    design_doc_title: options.designDocTitle,
    design_doc_extracted: false,
  };
  const analysisJsonPath = initAnalysis(workingDir, analysis);

  const sectionTreePath = join(workingDir, "section_tree.md");
  writeFileSync(sectionTreePath, formatSectionTreeMarkdown(section_tree), "utf-8");

  const tokenLimit = options.tokenLimit ?? DEFAULT_TOKEN_LIMIT;
  const chunks: ChunkInfo[] = chunkFragments(fragments, workingDir, tokenLimit);

  return {
    status: "Ok",
    working_dir: workingDir,
    document_id: documentId,
    design_doc_id: options.designDocId,
    design_doc_title: options.designDocTitle,
    section_tree_path: sectionTreePath,
    document_path: documentJsonPath,
    analysis_path: analysisJsonPath,
    chunks,
  };
}

// --- Private functions ---

function defaultTitle(documentPath: string): string {
  const base = documentPath.split("/").pop() ?? documentPath;
  return base.replace(/\.[^.]+$/, "");
}

function extractTitleFromContent(content: string): string | null {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("<!--")) continue;
    const match = /^#\s+(.+?)\s*$/.exec(trimmed);
    if (match !== null) return match[1].trim();
    return null;
  }
  return null;
}

function resolveDocumentId(documentPath: string): string {
  const content = readFileSync(documentPath, "utf-8");
  const firstLine = content.split("\n", 1)[0];
  const match = DOCUMENT_ID_PATTERN.exec(firstLine);
  if (match !== null) return match[1];

  const newId = randomUUID();
  writeFileSync(
    documentPath,
    `<!-- document_id: ${newId} -->\n${content}`,
    "utf-8",
  );
  return newId;
}

// --- Entry point ---

function main(): void {
  const args = parseArgs(
    ["document_path", "title", "date"],
    ["design_doc_id", "design_doc_title", "token_limit"],
  );
  requireFile(args["document_path"]);

  const tokenLimit = args["token_limit"]
    ? parseInt(args["token_limit"], 10)
    : DEFAULT_TOKEN_LIMIT;
  if (isNaN(tokenLimit) || tokenLimit <= 0) {
    exitError("token_limit must be a positive integer");
  }

  const result = prepareDocumentAnalysis(
    args["document_path"],
    args["title"],
    args["date"],
    {
      designDocId: args["design_doc_id"] ?? null,
      designDocTitle: args["design_doc_title"] ?? null,
      tokenLimit,
    },
  );

  outputResult(result);
}

if (import.meta.main) {
  main();
}
