import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { IndexStateService } from "../../indexer/index-state.service.js";
import { gateWriteTool } from "../../indexer/write-gate.js";
import {
  runFileOutputTool,
  runInlineJsonTool,
} from "../../mcp-tool-output.js";
import {
  DocumentsService,
  type TopicForDocumentReview,
} from "./documents.service.js";

export function registerDocumentsTools(
  mcp: McpServer,
  documents: DocumentsService,
  indexState: IndexStateService,
): void {
  registerAddDocument(mcp, documents, indexState);
  registerHasDocument(mcp, documents);
  registerGetTopicForDocumentReview(mcp, documents);
  registerListUnreviewedTopicsForDocument(mcp, documents);
  registerMergeDocument(mcp, documents, indexState);
}

function registerAddDocument(
  mcp: McpServer,
  documents: DocumentsService,
  indexState: IndexStateService,
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
      runInlineJsonTool(() =>
        gateWriteTool(indexState, () => documents.addDocumentFromFile(path)),
      ),
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
        "Load the next unreviewed Topic from a working output.json (document analysis flow). " +
        "Combines current-document fragments with prior-document fragments already attached to the same Topic " +
        "(prefixed `[from <doc title>]`). Writes the enriched topic Markdown (with HTML-comment metadata for " +
        "`topic_id`, `num_items`, `has_decision_units`) to a tmp file and returns the file path — read it with the Read tool. " +
        "If no unreviewed topic remains, returns inline JSON `{ status: \"Done\" }`.",
      inputSchema: {
        output_path: z
          .string()
          .describe(
            "Absolute path to the working output.json produced during document analysis.",
          ),
      },
    },
    async ({ output_path }) => {
      const review = await documents.getTopicForDocumentReview(output_path);
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

function registerListUnreviewedTopicsForDocument(
  mcp: McpServer,
  documents: DocumentsService,
): void {
  mcp.registerTool(
    "list_unreviewed_topics_for_document",
    {
      description:
        "Batch variant of `get_topic_for_document_review` for documents with many topics. " +
        "Returns every unreviewed topic's enriched view (current + prior-document fragments, with `[from <doc>]` markers) " +
        "in one Markdown bundle separated by `<!-- topic_id: ... -->` headers. " +
        "Writes the bundle to a tmp file and returns the file path — read it with the Read tool. " +
        "Use this when iterating per-topic would require >10 round-trips. " +
        "Per-topic verification is still mandatory: confirm prior-document fragments (if any) were folded into each summary.",
      inputSchema: {
        output_path: z
          .string()
          .describe(
            "Absolute path to the working output.json produced during document analysis.",
          ),
      },
    },
    async ({ output_path }) =>
      runFileOutputTool(
        "list_unreviewed_topics_for_document",
        () => documents.getAllUnreviewedTopicsForDocument(output_path),
        formatTopicsForDocumentReviewBundle,
      ),
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
  indexState: IndexStateService,
): void {
  mcp.registerTool(
    "merge_document",
    {
      description:
        "Merge a completed document analysis into the knowledge graph. Reads " +
        "`<working_dir>/output.json` (matching AnalyzeDesignDraftOutput: " +
        "`{ document, fragments, section_tree, topics, decision_attachments, potential_topics, design_doc_id?, design_doc_title? }`). " +
        "Persists the Document, upserts referenced Topics with parent linking, " +
        "attaches document-fragment items, creates Decisions, and applies attachments to existing Decisions. " +
        "Design Docs are persisted via the separate `save_design_doc` tool. " +
        "Returns inline JSON with counts.",
      inputSchema: {
        working_dir: z
          .string()
          .describe(
            "Absolute path to the analysis working directory containing output.json.",
          ),
      },
    },
    async ({ working_dir }) =>
      runInlineJsonTool(() =>
        gateWriteTool(indexState, () => documents.mergeDocument(working_dir)),
      ),
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

function formatTopicsForDocumentReviewBundle(
  reviews: TopicForDocumentReview[],
): string {
  if (reviews.length === 0) {
    return [
      "<!-- num_topics: 0 -->",
      "",
      "(no unreviewed topics — Step 5 is complete)",
    ].join("\n");
  }
  const parts: string[] = [
    `<!-- num_topics: ${reviews.length} -->`,
    "",
  ];
  for (const review of reviews) {
    parts.push(formatTopicForDocumentReview(review));
    parts.push("");
    parts.push("---");
    parts.push("");
  }
  return parts.join("\n").trimEnd();
}
