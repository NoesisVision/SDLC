import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync } from "fs";
import { join } from "path";
import { z } from "zod";
import {
  runFileOutputTool,
  runInlineJsonTool,
} from "../../mcp-tool-output.js";
import { DesignDocsService } from "../design-docs/design-docs.service.js";
import {
  DocumentsService,
  type TopicForDocumentReview,
} from "./documents.service.js";

export function registerDocumentsTools(
  mcp: McpServer,
  documents: DocumentsService,
  designDocs: DesignDocsService,
): void {
  registerAddDocument(mcp, documents);
  registerHasDocument(mcp, documents);
  registerGetTopicForDocumentReview(mcp, documents);
  registerMergeDocument(mcp, documents, designDocs);
}

function registerAddDocument(
  mcp: McpServer,
  documents: DocumentsService,
): void {
  mcp.registerTool(
    "add_document",
    {
      description:
        "Add a Document to the knowledge graph from a JSON file. " +
        "The document's content is stored on the Document node. " +
        "DocumentFragment nodes are created on demand when items reference this document. " +
        "Fails if a document with the same id already exists.",
      inputSchema: {
        path: z
          .string()
          .describe("Absolute path to a JSON file matching DocumentSchema."),
      },
    },
    async ({ path }) =>
      runInlineJsonTool(() => documents.addDocumentFromFile(path)),
  );
}

function registerGetTopicForDocumentReview(
  mcp: McpServer,
  documents: DocumentsService,
): void {
  mcp.registerTool(
    "get_topic_for_document_review",
    {
      description:
        "Load the next unreviewed Topic from a working analysis.json (document analysis flow). " +
        "Combines current-document fragments with prior-document fragments already attached to the same Topic " +
        "(prefixed `[from <doc title>]`). Writes the enriched topic Markdown (with HTML-comment metadata for " +
        "`topic_id`, `num_items`, `has_decision_units`) to a tmp file and returns the file path — read it with the Read tool. " +
        "If no unreviewed topic remains, returns inline JSON `{ status: \"Done\" }`.",
      inputSchema: {
        analysis_path: z
          .string()
          .describe(
            "Absolute path to the working analysis.json produced during document analysis.",
          ),
      },
    },
    async ({ analysis_path }) => {
      const review = await documents.getTopicForDocumentReview(analysis_path);
      if (review === null) {
        return runInlineJsonTool(async () => ({ status: "Done" }));
      }
      return runFileOutputTool(
        "get_topic_for_document_review",
        async () => review,
        formatTopicForDocumentReview,
      );
    },
  );
}

function registerHasDocument(
  mcp: McpServer,
  documents: DocumentsService,
): void {
  mcp.registerTool(
    "has_document",
    {
      description:
        "Check whether a Document with the given id is already in the knowledge graph.",
      inputSchema: {
        document_id: z.string().describe("Document id to look up."),
      },
    },
    async ({ document_id }) =>
      runInlineJsonTool(async () => ({
        document_id,
        exists: await documents.hasDocument(document_id),
      })),
  );
}

function registerMergeDocument(
  mcp: McpServer,
  documents: DocumentsService,
  designDocs: DesignDocsService,
): void {
  mcp.registerTool(
    "merge_document",
    {
      description:
        "Merge a completed document analysis into the knowledge graph. Reads " +
        "`<working_dir>/document.json` and `<working_dir>/analysis.json` " +
        "(and `potential_topics.json` for parent mapping), " +
        "persists the Document, upserts referenced Topics, " +
        "attaches document-fragment items, creates Decisions, and applies attachments to existing Decisions. " +
        "If `<working_dir>/design_doc.json` is present, also persists the DesignDoc via save_design_doc. " +
        "Returns inline JSON with counts.",
      inputSchema: {
        working_dir: z
          .string()
          .describe(
            "Absolute path to the analysis working directory containing document.json and analysis.json.",
          ),
      },
    },
    async ({ working_dir }) =>
      runInlineJsonTool(async () => {
        const result = await documents.mergeDocument(working_dir);
        const designPath = join(working_dir, "design_doc.json");
        if (existsSync(designPath)) {
          const designResult = await designDocs.saveDesignDocFromFile(
            designPath,
            null,
          );
          return { ...result, design_doc: designResult };
        }
        return { ...result, design_doc: null };
      }),
  );
}

function formatTopicForDocumentReview(review: TopicForDocumentReview): string {
  const header = [
    `<!-- topic_id: ${review.topic_id} -->`,
    `<!-- num_items: ${review.num_items} -->`,
    `<!-- has_decision_units: ${review.has_decision_units} -->`,
    "",
  ].join("\n");
  return header + review.markdown;
}
