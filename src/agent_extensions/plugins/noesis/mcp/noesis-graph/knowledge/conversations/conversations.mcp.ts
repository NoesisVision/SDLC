import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  runFileOutputTool,
  runInlineJsonTool,
} from "../../mcp-tool-output.js";
import {
  ConversationsService,
  type TopicForReview,
} from "./conversations.service.js";

export function registerConversationsTools(
  mcp: McpServer,
  conversations: ConversationsService,
): void {
  registerAddConversation(mcp, conversations);
  registerHasConversation(mcp, conversations);
  registerMergeConversation(mcp, conversations);
  registerGetTopicForReview(mcp, conversations);
}

function registerAddConversation(
  mcp: McpServer,
  conversations: ConversationsService,
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
      runInlineJsonTool(() => conversations.addConversationFromFile(path)),
  );
}

function registerGetTopicForReview(
  mcp: McpServer,
  conversations: ConversationsService,
): void {
  mcp.registerTool(
    "get_topic_for_review",
    {
      description:
        "Load the next unreviewed Topic from a working output.json for analysis. " +
        "Combines the current conversation's idea units with prior-conversation idea units " +
        "already attached to the same Topic in the knowledge graph (marked `[prior conversation]`). " +
        "Writes the enriched topic Markdown (with HTML-comment metadata for `topic_id`, `num_items`, " +
        "`has_decision_units`) to a tmp file and returns the file path. The agent must read it with the Read tool. " +
        "If no unreviewed topic remains, returns inline JSON `{ status: \"Done\" }`.",
      inputSchema: {
        output_path: z
          .string()
          .describe(
            "Absolute path to the working output.json produced during analysis.",
          ),
      },
    },
    async ({ output_path }) => {
      const review = await conversations.getTopicForReview(output_path);
      if (review === null) {
        return runInlineJsonTool(async () => ({ status: "Done" }));
      }
      return runFileOutputTool(
        "get_topic_for_review",
        async () => review,
        formatTopicForReview,
      );
    },
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
): void {
  mcp.registerTool(
    "merge_conversation",
    {
      description:
        "Merge a completed conversation analysis into the knowledge graph. Reads " +
        "`<working_dir>/output.json` (matching AnalyzeConversationOutput: `{ conversation, potential_topics }`). " +
        "Persists the Conversation + Turn + IdeaUnit nodes, upserts referenced Topics with parent linking, " +
        "attaches idea-unit / document-fragment items, and creates Decisions under their owning Topics. " +
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
      runInlineJsonTool(() => conversations.mergeConversation(working_dir)),
  );
}

function formatTopicForReview(review: TopicForReview): string {
  const header = [
    `<!-- topic_id: ${review.topic_id} -->`,
    `<!-- num_items: ${review.num_items} -->`,
    `<!-- has_decision_units: ${review.has_decision_units} -->`,
    "",
  ].join("\n");
  return header + review.markdown;
}
