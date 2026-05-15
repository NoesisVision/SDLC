import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { join } from "path";
import { z } from "zod";
import {
  runFileOutputTool,
  runInlineJsonTool,
} from "../../mcp-tool-output.js";
import { ConfirmedEditSchema } from "../locks.js";
import {
  ConversationsService,
  type ReviewBundle,
} from "./conversations.service.js";

export function registerConversationsTools(
  mcp: McpServer,
  conversations: ConversationsService,
): void {
  registerHasConversation(mcp, conversations);
  registerMergeConversation(mcp, conversations);
  registerPrepareReviewBundle(mcp, conversations);
  registerValidateOutput(mcp, conversations);
}

function registerHasConversation(
  mcp: McpServer,
  conversations: ConversationsService,
): void {
  mcp.registerTool(
    "has_conversation",
    {
      description:
        "Check whether a Conversation with the given id is already in the knowledge graph. " +
        "Skills MUST call this with the sha-derived id returned by prepare.ts before running " +
        "analysis. If `exists: true`, abort: the source has already been processed.",
      inputSchema: {
        conversation_id: z.string().describe("Conversation id to look up."),
      },
    },
    async ({ conversation_id }) =>
      runInlineJsonTool(async () => ({
        conversation_id,
        exists: await conversations.hasConversation(conversation_id),
      })),
  );
}

function registerMergeConversation(
  mcp: McpServer,
  conversations: ConversationsService,
): void {
  mcp.registerTool(
    "merge_conversation",
    {
      description:
        "Merge a completed conversation analysis into the knowledge graph. Reads " +
        "`<working_dir>/output.json` (matching AnalyzeConversationOutput) and splits it into source " +
        "files under `<projectDir>/noesis/`: the Conversation JSON file, per-topic JSON files, " +
        "and per-decision JSON files. No markdown is written to noesis. Runs business-level " +
        "validation (refs resolve, all topics reviewed, etc.) and rejects before any file write on " +
        "validation errors. Rejects with a duplicate error if a Conversation with the same id is " +
        "already in the graph. If a previously-saved topic/decision has any user-edited " +
        "(`*_locked: true`) field whose value would be overwritten by the merge, the call rejects " +
        "with a list of blocked locked fields; re-call with `confirmed_edits` containing only the " +
        "locks the user explicitly approved to overwrite. Returns the canonical paths of the files written.",
      inputSchema: {
        working_dir: z
          .string()
          .describe(
            "Absolute path to the analysis working directory containing output.json.",
          ),
        confirmed_edits: z
          .array(ConfirmedEditSchema)
          .optional()
          .describe(
            "Locked-field overrides the user has explicitly approved. Each entry is " +
              "`{ kind: 'topic'|'decision', topic_id|decision_id, field }`. Required only when a " +
              "previous call rejected with locked-field conflicts. Agent must NEVER include a lock " +
              "here without explicit user confirmation per AskUserQuestion.",
          ),
      },
    },
    async ({ working_dir, confirmed_edits }) =>
      runInlineJsonTool(() =>
        conversations.uploadAnalysis({
          outputJsonPath: join(working_dir, "output.json"),
          confirmed_edits,
        }),
      ),
  );
}

function registerPrepareReviewBundle(
  mcp: McpServer,
  conversations: ConversationsService,
): void {
  mcp.registerTool(
    "prepare_review_bundle",
    {
      description:
        "Build the Step 4 review bundle from `<output_path>` (the working output.json). Returns a single " +
        "Markdown file containing every topic in post-order, each section preceded by HTML-comment metadata. " +
        "Inline JSON includes `topic_count` and `topics_with_prior_units`.",
      inputSchema: {
        output_path: z
          .string()
          .describe(
            "Absolute path to the working output.json produced during analysis.",
          ),
      },
    },
    async ({ output_path }) => {
      const bundle = await conversations.prepareReviewBundle(output_path);
      return runFileOutputTool(
        "prepare_review_bundle",
        async () => bundle,
        formatBundle,
        "md",
        (b) => ({
          topic_count: b.topic_count,
          topics_with_prior_units: b.topics_with_prior_units,
        }),
      );
    },
  );
}

function registerValidateOutput(
  mcp: McpServer,
  conversations: ConversationsService,
): void {
  mcp.registerTool(
    "validate_output",
    {
      description:
        "Validate `<working_dir>/output.json` against every cross-cutting invariant required by " +
        "`merge_conversation`. Returns `{ status: \"Ok\", warnings }` or `{ status: \"Errors\", errors, warnings }`.",
      inputSchema: {
        working_dir: z
          .string()
          .describe(
            "Absolute path to the analysis working directory containing output.json.",
          ),
      },
    },
    async ({ working_dir }) =>
      runInlineJsonTool(() => conversations.validateOutput(working_dir)),
  );
}

function formatBundle(bundle: ReviewBundle): string {
  return bundle.markdown;
}
