import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { contentHashAsUuid } from "../../shared-contracts/uuid.js";
import { exitError, outputResult, parseArgs, requireFile } from "../io.js";
import { fragmentMarkdown } from "./fragment-markdown.js";
import {
  AnalyzeDesignDraftOutputSchema,
  type AnalyzeDesignDraftOutput,
} from "../../shared-contracts/skills/analyze-design-draft/output.js";
import { formatSectionTreeMarkdown } from "../../shared-contracts/documents.js";
import { resolveWorkingDir } from "../../shared-contracts/plugin-paths.js";

const SKILL_NAME = "noesis:analyze-design-draft";
const FILE_MODE = 0o600;

interface PrepareResult {
  status: "Ok";
  working_dir: string;
  document_id: string;
  output_path: string;
  section_tree_path: string;
  source_path: string;
  num_fragments: number;
  design_doc_id: string | null;
  design_doc_title: string | null;
}

interface PrepareOptions {
  designDocId: string | null;
  designDocTitle: string | null;
  workingDirBase?: string;
  projectDir?: string;
}

// --- Public functions ---

export function prepareDocument(
  documentPath: string,
  title: string,
  date: string,
  options: PrepareOptions,
): PrepareResult {
  resolveProjectDir(options.projectDir);
  const sourceContent = readFileSync(documentPath, "utf-8");
  const documentId = contentHashAsUuid(sourceContent);

  const resolvedTitle =
    title.trim() !== ""
      ? title
      : extractTitleFromContent(sourceContent) ?? defaultTitle(documentPath);

  const { fragments, section_tree } = fragmentMarkdown(sourceContent);

  const workingDir = resolveWorkingDir(
    SKILL_NAME,
    documentId,
    options.workingDirBase,
  );
  mkdirSync(workingDir, { recursive: true });

  const output: AnalyzeDesignDraftOutput = {
    document: {
      id: documentId,
      title: resolvedTitle,
      date,
      content: sourceContent,
    },
    fragments,
    section_tree,
    topics: [],
    decision_attachments: [],
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
    output_path: outputPath,
    section_tree_path: sectionTreePath,
    source_path: documentPath,
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

function resolveProjectDir(explicit: string | undefined): string {
  if (explicit !== undefined && explicit !== "") return explicit;
  const fromEnv =
    process.env["CLAUDE_PROJECT_DIR"] ?? process.env["NOESIS_PROJECT_DIR"];
  if (fromEnv === undefined || fromEnv === "") {
    throw new Error(
      "Project directory is required. Set CLAUDE_PROJECT_DIR or NOESIS_PROJECT_DIR.",
    );
  }
  return fromEnv;
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
