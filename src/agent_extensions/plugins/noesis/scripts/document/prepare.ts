import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { exitError, outputResult, parseArgs, requireFile } from "../io.js";
import { fragmentMarkdown } from "./fragment-markdown.js";
import {
  DocumentAnalysisSchema,
  formatSectionTreeMarkdown,
  type DocumentAnalysis,
} from "../../shared-contracts/document-analysis.js";
import { DocumentSchema } from "../../shared-contracts/documents.js";

const DOCUMENT_ID_PATTERN = /^<!--\s*document_id:\s*([\w-]+)\s*-->/;

interface PrepareResult {
  status: "Ok";
  working_dir: string;
  document_id: string;
  cleaned_path: string;
  document_path: string;
  analysis_path: string;
  section_tree_path: string;
  num_fragments: number;
  design_doc_id: string | null;
  design_doc_title: string | null;
}

interface PrepareOptions {
  designDocId: string | null;
  designDocTitle: string | null;
}

// --- Public functions ---

export function buildCleanedMarkdown(documentId: string, content: string): string {
  const stripped = stripDocumentIdLine(content);
  return `<!-- document_id: ${documentId} -->\n${stripped}`;
}

export function getCleanedPath(documentPath: string): string {
  return documentPath.replace(/\.[^./]+$/, "") + "-cleaned.md";
}

export function prepareDocument(
  documentPath: string,
  title: string,
  date: string,
  options: PrepareOptions,
): PrepareResult {
  const cleanedPath = getCleanedPath(documentPath);
  const documentId = resolveDocumentId(documentPath, cleanedPath);

  const sourceContent = readFileSync(documentPath, "utf-8");
  const cleanedContent = buildCleanedMarkdown(documentId, sourceContent);
  writeFileSync(cleanedPath, cleanedContent, "utf-8");

  const resolvedTitle =
    title.trim() !== ""
      ? title
      : extractTitleFromContent(cleanedContent) ?? defaultTitle(documentPath);

  const { fragments, section_tree } = fragmentMarkdown(cleanedContent);

  const workingDir = join("/tmp", `noesis-doc-${documentId}`);
  mkdirSync(workingDir, { recursive: true });

  const document = {
    id: documentId,
    title: resolvedTitle,
    date,
    content: cleanedContent,
  };
  DocumentSchema.parse(document);
  const documentJsonPath = join(workingDir, "document.json");
  writeFileSync(documentJsonPath, JSON.stringify(document, null, 2), "utf-8");

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
  DocumentAnalysisSchema.parse(analysis);
  const analysisJsonPath = join(workingDir, "analysis.json");
  writeFileSync(analysisJsonPath, JSON.stringify(analysis, null, 2), "utf-8");

  const sectionTreePath = join(workingDir, "section_tree.md");
  writeFileSync(sectionTreePath, formatSectionTreeMarkdown(section_tree), "utf-8");

  return {
    status: "Ok",
    working_dir: workingDir,
    document_id: documentId,
    cleaned_path: cleanedPath,
    document_path: documentJsonPath,
    analysis_path: analysisJsonPath,
    section_tree_path: sectionTreePath,
    num_fragments: fragments.length,
    design_doc_id: options.designDocId,
    design_doc_title: options.designDocTitle,
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

function readIdFromHeader(path: string): string | null {
  if (!existsSync(path)) return null;
  const firstLine = readFileSync(path, "utf-8").split("\n", 1)[0];
  const match = DOCUMENT_ID_PATTERN.exec(firstLine);
  return match !== null ? match[1] : null;
}

function resolveDocumentId(documentPath: string, cleanedPath: string): string {
  const fromCleaned = readIdFromHeader(cleanedPath);
  if (fromCleaned !== null) return fromCleaned;
  const fromSource = readIdFromHeader(documentPath);
  if (fromSource !== null) return fromSource;
  return randomUUID();
}

function stripDocumentIdLine(content: string): string {
  const newlineIndex = content.indexOf("\n");
  const firstLine = newlineIndex === -1 ? content : content.slice(0, newlineIndex);
  if (DOCUMENT_ID_PATTERN.test(firstLine)) {
    return newlineIndex === -1 ? "" : content.slice(newlineIndex + 1);
  }
  return content;
}

// --- Entry point ---

function main(): void {
  const args = parseArgs(
    ["document_path", "title", "date"],
    ["design_doc_id", "design_doc_title"],
  );
  requireFile(args["document_path"]);

  try {
    const result = prepareDocument(
      args["document_path"],
      args["title"],
      args["date"],
      {
        designDocId: args["design_doc_id"] ?? null,
        designDocTitle: args["design_doc_title"] ?? null,
      },
    );
    outputResult(result);
  } catch (err) {
    exitError(err instanceof Error ? err.message : String(err));
  }
}

if (import.meta.main) {
  main();
}
