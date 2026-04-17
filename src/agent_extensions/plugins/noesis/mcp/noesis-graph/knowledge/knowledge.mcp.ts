import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DecisionSchema,
  TopicItemSchema,
} from "../../../shared-contracts/topics.js";
import { KnowledgeService } from "./knowledge.service.js";
import type { DecisionSupportSlot } from "./knowledge.types.js";

const TopicFields = {
  id: z
    .string()
    .optional()
    .describe("Topic UUID. If omitted, one is generated."),
  title: z.string().describe("Short topic title."),
  short_summary: z.string().describe("One-sentence summary of the topic."),
  long_summary: z
    .string()
    .optional()
    .describe("Longer summary. Defaults to empty string."),
};

const SlotSchema = z
  .enum(["context", "decision", "alternative"])
  .describe(
    "Which supporting-items slot on the Decision to attach items to. " +
      "'context' = context.supporting_items, " +
      "'decision' = decision.supporting_items, " +
      "'alternative' = alternative_options[alternative_index].supporting_items.",
  );

export function registerKnowledgeTools(
  mcp: McpServer,
  knowledge: KnowledgeService,
): void {
  registerAddTopic(mcp, knowledge);
  registerAddSubtopic(mcp, knowledge);
  registerReparentTopic(mcp, knowledge);
  registerAddItemsToTopic(mcp, knowledge);
  registerAddDecision(mcp, knowledge);
  registerAddItemsToDecision(mcp, knowledge);
  registerAddDocument(mcp, knowledge);
  registerAddConversation(mcp, knowledge);
}

function registerAddConversation(
  mcp: McpServer,
  knowledge: KnowledgeService,
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
    async ({ path }) => runTool(() => knowledge.addConversationFromFile(path)),
  );
}

function registerAddDecision(
  mcp: McpServer,
  knowledge: KnowledgeService,
): void {
  mcp.registerTool(
    "add_decision",
    {
      description:
        "Add a Decision and attach it to a Topic. Creates the Decision node, " +
        "an AlternativeOption node per alternative, and edges for all supporting items " +
        "(context, decision, and each alternative). Referenced IdeaUnits must already exist " +
        "(add conversations first); DocumentFragment nodes are created on demand as long as " +
        "the parent Document exists.",
      inputSchema: {
        topic_id: z.string().describe("Id of the Topic to attach the Decision to."),
        decision: DecisionSchema.describe(
          "Decision payload. If 'id' is omitted, a UUID is generated.",
        ),
      },
    },
    async ({ topic_id, decision }) =>
      runTool(() => knowledge.addDecision(topic_id, decision)),
  );
}

function registerAddDocument(
  mcp: McpServer,
  knowledge: KnowledgeService,
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
    async ({ path }) => runTool(() => knowledge.addDocumentFromFile(path)),
  );
}

function registerAddItemsToDecision(
  mcp: McpServer,
  knowledge: KnowledgeService,
): void {
  mcp.registerTool(
    "add_items_to_decision",
    {
      description:
        "Attach IdeaUnits or DocumentFragments to a specific supporting-items slot on a Decision. " +
        "Slot 'alternative' requires 'alternative_index' to pick which alternative option. " +
        "Referenced IdeaUnits must already exist; DocumentFragment nodes are created on demand " +
        "as long as the parent Document exists.",
      inputSchema: {
        decision_id: z.string().describe("Id of the target Decision."),
        slot: SlotSchema,
        alternative_index: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Index of the alternative option. Required when slot='alternative'."),
        items: z
          .array(TopicItemSchema)
          .describe("ConversationIdeaUnit or DocumentFragment references to attach."),
      },
    },
    async ({ decision_id, slot, alternative_index, items }) =>
      runTool(() => {
        const resolvedSlot = resolveSlot(slot, alternative_index);
        return knowledge.addItemsToDecisionSlot(decision_id, resolvedSlot, items);
      }),
  );
}

function registerAddItemsToTopic(
  mcp: McpServer,
  knowledge: KnowledgeService,
): void {
  mcp.registerTool(
    "add_items_to_topic",
    {
      description:
        "Attach IdeaUnits or DocumentFragments to a Topic. Referenced IdeaUnits must already exist; " +
        "DocumentFragment nodes are created on demand as long as the parent Document exists.",
      inputSchema: {
        topic_id: z.string().describe("Id of the target Topic."),
        items: z
          .array(TopicItemSchema)
          .describe("ConversationIdeaUnit or DocumentFragment references to attach."),
      },
    },
    async ({ topic_id, items }) =>
      runTool(() => knowledge.addItemsToTopic(topic_id, items)),
  );
}

function registerAddSubtopic(
  mcp: McpServer,
  knowledge: KnowledgeService,
): void {
  mcp.registerTool(
    "add_subtopic",
    {
      description:
        "Add a new Topic as a subtopic under an existing parent Topic. " +
        "Fails if the parent does not exist.",
      inputSchema: {
        parent_topic_id: z.string().describe("Id of the parent Topic."),
        ...TopicFields,
      },
    },
    async ({ parent_topic_id, id, title, short_summary, long_summary }) =>
      runTool(() =>
        knowledge.addSubtopic(parent_topic_id, {
          id,
          title,
          short_summary,
          long_summary,
        }),
      ),
  );
}

function registerAddTopic(mcp: McpServer, knowledge: KnowledgeService): void {
  mcp.registerTool(
    "add_topic",
    {
      description:
        "Add a new top-level Topic to the knowledge graph. " +
        "Use add_subtopic to attach a topic under a parent.",
      inputSchema: TopicFields,
    },
    async ({ id, title, short_summary, long_summary }) =>
      runTool(() =>
        knowledge.addTopic({ id, title, short_summary, long_summary }),
      ),
  );
}

function registerReparentTopic(
  mcp: McpServer,
  knowledge: KnowledgeService,
): void {
  mcp.registerTool(
    "reparent_topic",
    {
      description:
        "Move a Topic under a new parent Topic, or make it top-level by passing null. " +
        "Fails if the topic or target parent does not exist.",
      inputSchema: {
        topic_id: z.string().describe("Id of the Topic to move."),
        new_parent_topic_id: z
          .string()
          .nullable()
          .describe("Id of the new parent Topic, or null to make it top-level."),
      },
    },
    async ({ topic_id, new_parent_topic_id }) =>
      runTool(() => knowledge.reparentTopic(topic_id, new_parent_topic_id)),
  );
}

function resolveSlot(
  slot: "context" | "decision" | "alternative",
  alternativeIndex: number | undefined,
): DecisionSupportSlot {
  if (slot === "alternative") {
    if (alternativeIndex === undefined) {
      throw new Error(
        "alternative_index is required when slot='alternative'",
      );
    }
    return { slot, alternative_index: alternativeIndex };
  }
  return { slot };
}

async function runTool<T>(
  fn: () => Promise<T>,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const result = await fn();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: message }], isError: true };
  }
}
