import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { randomUUID } from "crypto";
import { exitError, outputResult, parseArgs, requireFile } from "../io.js";
import { fragmentMarkdown } from "./fragment-markdown.js";
import {
  AnalyzeDesignDraftOutputSchema,
  type AnalyzeDesignDraftOutput,
} from "../../shared-contracts/skills/analyze-design-draft/output.js";
import { formatSectionTreeMarkdown } from "../../shared-contracts/documents.js";
import { resolveScriptTmpDir } from "../../shared-contracts/plugin-paths.js";

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

const DOCUMENT_ID_PATTERN = /^<!--\s*document_id:\s*([\w-]+)\s*-->/;

interface PrepareResult {
  status: "Ok";
  working_dir: string;
  document_id: string;
  cleaned_path: string;
  output_path: string;
  section_tree_path: string;
  num_fragments: number;
  design_doc_id: string | null;
  design_doc_title: string | null;
}

interface PrepareOptions {
  designDocId: string | null;
  designDocTitle: string | null;
  workingDirBase?: string;
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

  const baseDir = options.workingDirBase ?? resolveScriptTmpDir();
  const workingDir = join(baseDir, `noesis-doc-${documentId}`);
  mkdirSync(workingDir, { recursive: true, mode: DIR_MODE });

  const output: AnalyzeDesignDraftOutput = {
    document: {
      id: documentId,
      title: resolvedTitle,
      date,
      content: cleanedContent,
    },
    fragments,
    section_tree,
    topics: [],
    decision_attachments: [],
    potential_topics: { topics: [] },
    design_doc_id: options.designDocId,
    design_doc_title: options.designDocTitle,
    design_doc_extracted: false,
  };
  AnalyzeDesignDraftOutputSchema.parse(output);
  const outputPath = join(workingDir, "output.json");
  writeFileSync(outputPath, JSON.stringify(output, null, 2), {
    encoding: "utf-8",
    mode: FILE_MODE,
  });

  const sectionTreePath = join(workingDir, "section_tree.md");
  writeFileSync(sectionTreePath, formatSectionTreeMarkdown(section_tree), {
    encoding: "utf-8",
    mode: FILE_MODE,
  });

  return {
    status: "Ok",
    working_dir: workingDir,
    document_id: documentId,
    cleaned_path: cleanedPath,
    output_path: outputPath,
    section_tree_path: sectionTreePath,
    num_fragments: fragments.length,
    design_doc_id: options.designDocId,
    design_doc_title: options.designDocTitle,
  };
}

// --- Private functions ---

function defaultTitle(documentPath: string): string {
  return basename(documentPath).replace(/\.[^.]+$/, "");
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
