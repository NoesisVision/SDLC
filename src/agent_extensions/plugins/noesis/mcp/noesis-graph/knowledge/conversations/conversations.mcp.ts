import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { IndexStateService } from "../../indexer/index-state.service.js";
import { gateWriteTool } from "../../indexer/write-gate.js";
import {
  runFileOutputTool,
  runInlineJsonTool,
} from "../../mcp-tool-output.js";
import {
  ConversationsService,
  type ReviewBundle,
} from "./conversations.service.js";

export function registerConversationsTools(
  mcp: McpServer,
  conversations: ConversationsService,
  indexState: IndexStateService,
): void {
  registerAddConversation(mcp, conversations, indexState);
  registerHasConversation(mcp, conversations);
  registerMergeConversation(mcp, conversations, indexState);
  registerPrepareReviewBundle(mcp, conversations);
  registerValidateOutput(mcp, conversations);
}

function registerAddConversation(
  mcp: McpServer,
  conversations: ConversationsService,
  indexState: IndexStateService,
): void {
  mcp.registerTool(
    "add_conversation",
    {
      description:
        "Add a Conversation to the knowledge graph from a JSON file. " +
        "Creates Conversation, Turn, and IdeaUnit nodes with their containment edges. " +
        "Topics and decisions inside the conversation JSON are ignored — use add_topic / add_decision for those. " +
        "Fails if a conversation with the same id already exists.",
      inputSchema: {
        path: z
          .string()
          .describe("Absolute path to a JSON file matching ConversationSchema."),
      },
    },
    async ({ path }) =>
      runInlineJsonTool(() =>
        gateWriteTool(indexState, () => conversations.addConversationFromFile(path)),
      ),
  );
}

function registerHasConversation(
  mcp: McpServer,
  conversations: ConversationsService,
): void {
  mcp.registerTool(
    "has_conversation",
    {
      description:
        "Check whether a Conversation with the given id is already in the knowledge graph.",
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
  indexState: IndexStateService,
): void {
  mcp.registerTool(
    "merge_conversation",
    {
      description:
        "Merge a completed conversation analysis into the knowledge graph. Reads " +
        "`<working_dir>/output.json` (matching AnalyzeConversationOutput: `{ conversation, potential_topics }`). " +
        "Persists the Conversation + Turn + IdeaUnit nodes, upserts referenced Topics with parent linking, " +
        "attaches idea-unit / document-fragment items, and creates Decisions under their owning Topics. " +
        "Runs `validate_output` as a pre-flight gate and rejects with the same error shape on failure. " +
        "Fails if the conversation id already exists in the graph.",
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
        gateWriteTool(indexState, () => conversations.mergeConversation(working_dir)),
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
        "Build the Step 4 review bundle from `<working_dir>/output.json`. Returns a single " +
        "Markdown file containing every topic in post-order (leaves first, parents last), each section " +
        "preceded by HTML-comment metadata `<!-- topic_id: ... -->`, `<!-- num_items: ... -->`, " +
        "`<!-- has_decision_units: ... -->`. Sections include `## Subtopics` with finalized child summaries " +
        "(or `_(pending review)_`) and `[prior conversation]` markers on idea units that originate from other " +
        "conversations already attached to the same topic. The agent reads the bundle once and writes all " +
        "summaries+decisions in topic order. Inline JSON includes `topic_count` and `topics_with_prior_units`.",
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
        "Validate `<working_dir>/output.json` against every cross-cutting invariant required " +
        "by `merge_conversation`: schema parse, idea-unit assignment coverage, topic-id consistency " +
        "between conversation.topics and potential_topics, reference integrity to existing idea units, " +
        "decision shape (slot indices in range, no orphan referenced_items), and topic forest integrity " +
        "(parent_id resolves, no cycles). Returns `{ status: \"Ok\", warnings }` or " +
        "`{ status: \"Errors\", errors, warnings }` with JSON-pointer-style paths. Warnings are advisory " +
        "(first-level breadth, large own-item counts) and never block.",
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
