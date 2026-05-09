import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { join } from "path";
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
): void {
  registerHasDocument(mcp, documents);
  registerGetTopicForDocumentReview(mcp, documents);
  registerListUnreviewedTopicsForDocument(mcp, documents);
  registerMergeDocument(mcp, documents);
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
        "Returns every unreviewed topic's enriched view in one Markdown bundle. " +
        "Writes the bundle to a tmp file and returns the file path — read it with the Read tool.",
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
): void {
  mcp.registerTool(
    "merge_document",
    {
      description:
        "Merge a completed document analysis into the knowledge graph. Reads " +
        "`<working_dir>/output.json` and the optional design-doc working file. " +
        "Splits the analysis into source files under `<projectDir>/noesis/` and projects them to the graph. " +
        "Returns inline JSON with the canonical paths written.",
      inputSchema: {
        working_dir: z
          .string()
          .describe(
            "Absolute path to the analysis working directory containing output.json.",
          ),
        design_doc_filename: z
          .string()
          .nullable()
          .optional()
          .describe(
            "Optional filename (within the working directory) of the design-doc JSON.",
          ),
      },
    },
    async ({ working_dir, design_doc_filename }) =>
      runInlineJsonTool(() =>
        documents.uploadAnalysis({
          outputJsonPath: join(working_dir, "output.json"),
          designDocJsonPath:
            design_doc_filename === null || design_doc_filename === undefined
              ? null
              : join(working_dir, design_doc_filename),
        }),
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
  const parts: string[] = [`<!-- num_topics: ${reviews.length} -->`, ""];
  for (const review of reviews) {
    parts.push(formatTopicForDocumentReview(review));
    parts.push("");
    parts.push("---");
    parts.push("");
  }
  return parts.join("\n").trimEnd();
}
