import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync } from "fs";
import { join } from "path";
import { z } from "zod";
import {
  DecisionSchema,
  TopicItemSchema,
} from "../../../shared-contracts/topics.js";
import {
  KnowledgeService,
  type TopicForDocumentReview,
  type TopicForReview,
} from "./knowledge.service.js";
import type {
  DecisionDetail,
  DecisionOverview,
  TopicDetail,
  TopicOverview,
} from "./knowledge.repository.js";
import type { DecisionSupportSlot } from "./decision-support.js";
import { assertNever } from "../../../shared-contracts/assert-never.js";
import { DesignDocService } from "../design-doc/design-doc.service.js";
import {
  runFileOutputTool,
  runInlineJsonTool,
} from "../mcp-tool-output.js";

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
  designDoc: DesignDocService,
): void {
  registerAddTopic(mcp, knowledge);
  registerAddSubtopic(mcp, knowledge);
  registerReparentTopic(mcp, knowledge);
  registerAddItemsToTopic(mcp, knowledge);
  registerAddDecision(mcp, knowledge);
  registerAddItemsToDecision(mcp, knowledge);
  registerAddDocument(mcp, knowledge);
  registerAddConversation(mcp, knowledge);
  registerListTopics(mcp, knowledge);
  registerReadTopic(mcp, knowledge);
  registerHasConversation(mcp, knowledge);
  registerHasDocument(mcp, knowledge);
  registerListDecisions(mcp, knowledge);
  registerReadDecision(mcp, knowledge);
  registerGetTopicForReview(mcp, knowledge);
  registerGetTopicForDocumentReview(mcp, knowledge);
  registerMergeConversation(mcp, knowledge);
  registerMergeDocument(mcp, knowledge, designDoc);
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
    async ({ path }) =>
      runInlineJsonTool(() => knowledge.addConversationFromFile(path)),
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
      runInlineJsonTool(() => knowledge.addDecision(topic_id, decision)),
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
    async ({ path }) =>
      runInlineJsonTool(() => knowledge.addDocumentFromFile(path)),
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
          .describe("IdeaUnitRef or DocumentFragmentRef references to attach."),
      },
    },
    async ({ decision_id, slot, alternative_index, items }) =>
      runInlineJsonTool(() => {
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
          .describe("IdeaUnitRef or DocumentFragmentRef references to attach."),
      },
    },
    async ({ topic_id, items }) =>
      runInlineJsonTool(() => knowledge.addItemsToTopic(topic_id, items)),
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
      runInlineJsonTool(() =>
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
      runInlineJsonTool(() =>
        knowledge.addTopic({ id, title, short_summary, long_summary }),
      ),
  );
}

function registerGetTopicForReview(
  mcp: McpServer,
  knowledge: KnowledgeService,
): void {
  mcp.registerTool(
    "get_topic_for_review",
    {
      description:
        "Load the next unreviewed Topic from a working conversation.json for analysis. " +
        "Combines the current conversation's idea units with prior-conversation idea units " +
        "already attached to the same Topic in the knowledge graph (marked `[prior conversation]`). " +
        "Writes the enriched topic Markdown (with HTML-comment metadata for `topic_id`, `num_items`, " +
        "`has_decision_units`) to a tmp file and returns the file path. The agent must read it with the Read tool. " +
        "If no unreviewed topic remains, returns inline JSON `{ status: \"Done\" }`.",
      inputSchema: {
        conversation_path: z
          .string()
          .describe(
            "Absolute path to the working conversation.json produced during analysis.",
          ),
      },
    },
    async ({ conversation_path }) => {
      const review = await knowledge.getTopicForReview(conversation_path);
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
  knowledge: KnowledgeService,
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
        exists: await knowledge.hasConversation(conversation_id),
      })),
  );
}

function registerHasDocument(
  mcp: McpServer,
  knowledge: KnowledgeService,
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
        exists: await knowledge.hasDocument(document_id),
      })),
  );
}

function registerListDecisions(
  mcp: McpServer,
  knowledge: KnowledgeService,
): void {
  mcp.registerTool(
    "list_decisions",
    {
      description:
        "List Decisions in the knowledge graph. Without `topic_id`, returns all decisions across topics. " +
        "With `topic_id`, returns decisions attached to that topic. Writes Markdown (id, topic, title, status, context) " +
        "to a tmp file and returns the file path — read it with the Read tool.",
      inputSchema: {
        topic_id: z
          .string()
          .nullable()
          .optional()
          .describe(
            "Topic id to filter by. Omit or pass null to list all decisions.",
          ),
      },
    },
    async ({ topic_id }) =>
      runFileOutputTool(
        "list_decisions",
        () => knowledge.listDecisions(topic_id ?? null),
        (decisions) => formatDecisionList(decisions, topic_id ?? null),
      ),
  );
}

function registerReadDecision(
  mcp: McpServer,
  knowledge: KnowledgeService,
): void {
  mcp.registerTool(
    "read_decision",
    {
      description:
        "Read full Decision detail — title, status, context, decision rationale, alternatives. " +
        "Writes Markdown to a tmp file and returns the file path — read it with the Read tool.",
      inputSchema: {
        decision_id: z.string().describe("Id of the Decision to read."),
      },
    },
    async ({ decision_id }) =>
      runFileOutputTool(
        "read_decision",
        () => knowledge.readDecision(decision_id),
        (detail) => formatDecisionDetail(detail, decision_id),
      ),
  );
}

function registerGetTopicForDocumentReview(
  mcp: McpServer,
  knowledge: KnowledgeService,
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
      const review = await knowledge.getTopicForDocumentReview(analysis_path);
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

function registerMergeDocument(
  mcp: McpServer,
  knowledge: KnowledgeService,
  designDoc: DesignDocService,
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
        const result = await knowledge.mergeDocument(working_dir);
        const designPath = join(working_dir, "design_doc.json");
        if (existsSync(designPath)) {
          const designResult = await designDoc.saveDesignDocFromFile(
            designPath,
            null,
          );
          return { ...result, design_doc: designResult };
        }
        return { ...result, design_doc: null };
      }),
  );
}

function registerListTopics(
  mcp: McpServer,
  knowledge: KnowledgeService,
): void {
  mcp.registerTool(
    "list_topics",
    {
      description:
        "List Topics in the knowledge graph. Without `parent_topic_id`, returns root topics. " +
        "With `parent_topic_id`, returns direct subtopics. Writes Markdown (id, title, short/long summary, " +
        "path, has_subtopics) to a tmp file and returns the file path — read it with the Read tool.",
      inputSchema: {
        parent_topic_id: z
          .string()
          .nullable()
          .optional()
          .describe(
            "Parent topic id. Omit or pass null to list top-level topics.",
          ),
      },
    },
    async ({ parent_topic_id }) =>
      runFileOutputTool(
        "list_topics",
        () => knowledge.listTopics(parent_topic_id ?? null),
        (topics) => formatTopicList(topics, parent_topic_id ?? null),
      ),
  );
}

function registerMergeConversation(
  mcp: McpServer,
  knowledge: KnowledgeService,
): void {
  mcp.registerTool(
    "merge_conversation",
    {
      description:
        "Merge a completed conversation analysis into the knowledge graph. Reads " +
        "`<working_dir>/conversation.json` (and `potential_topics.json` for parent mapping), " +
        "persists the Conversation + Turn + IdeaUnit nodes, upserts referenced Topics, " +
        "attaches idea-unit / document-fragment items, and creates Decisions under their owning Topics. " +
        "Fails if the conversation id already exists in the graph.",
      inputSchema: {
        working_dir: z
          .string()
          .describe(
            "Absolute path to the analysis working directory containing conversation.json.",
          ),
      },
    },
    async ({ working_dir }) =>
      runInlineJsonTool(() => knowledge.mergeConversation(working_dir)),
  );
}

function registerReadTopic(
  mcp: McpServer,
  knowledge: KnowledgeService,
): void {
  mcp.registerTool(
    "read_topic",
    {
      description:
        "Read full Topic detail — id, title, hierarchical path, short and long summaries. " +
        "Writes Markdown to a tmp file and returns the file path — read it with the Read tool.",
      inputSchema: {
        topic_id: z.string().describe("Id of the Topic to read."),
      },
    },
    async ({ topic_id }) =>
      runFileOutputTool(
        "read_topic",
        () => knowledge.readTopic(topic_id),
        (topic) => formatTopicDetail(topic, topic_id),
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
      runInlineJsonTool(() =>
        knowledge.reparentTopic(topic_id, new_parent_topic_id),
      ),
  );
}

function resolveSlot(
  slot: "context" | "decision" | "alternative",
  alternativeIndex: number | undefined,
): DecisionSupportSlot {
  switch (slot) {
    case "context":
    case "decision":
      return { slot };
    case "alternative":
      if (alternativeIndex === undefined) {
        throw new Error(
          "alternative_index is required when slot='alternative'",
        );
      }
      return { slot, alternative_index: alternativeIndex };
    default:
      return assertNever(slot);
  }
}

function formatTopicDetail(
  topic: TopicDetail | null,
  requestedId: string,
): string {
  if (topic === null) {
    return `Topic not found: ${requestedId}`;
  }
  const pathLine = topic.path.length > 0 ? topic.path.join(" / ") : "(root)";
  const lines = [
    `# ${topic.title}`,
    `- **ID:** ${topic.id}`,
    `- **Path:** ${pathLine}`,
    `- **Short summary:** ${topic.short_summary || "(empty)"}`,
    "",
    "## Long summary",
    "",
    topic.long_summary || "(empty)",
  ];
  return lines.join("\n");
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

function formatTopicForDocumentReview(review: TopicForDocumentReview): string {
  const header = [
    `<!-- topic_id: ${review.topic_id} -->`,
    `<!-- num_items: ${review.num_items} -->`,
    `<!-- has_decision_units: ${review.has_decision_units} -->`,
    "",
  ].join("\n");
  return header + review.markdown;
}

function formatDecisionList(
  decisions: DecisionOverview[],
  topicId: string | null,
): string {
  const header = topicId === null
    ? "# All decisions"
    : `# Decisions for topic ${topicId}`;
  if (decisions.length === 0) {
    return `${header}\n\n(none)`;
  }
  const parts: string[] = [header, ""];
  for (const d of decisions) {
    parts.push(`## ${d.title}`);
    parts.push(`- **ID:** ${d.id}`);
    parts.push(`- **Topic:** ${d.topic_title} (${d.topic_id})`);
    parts.push(`- **Status:** ${d.status}`);
    parts.push(`- **Context:** ${d.context_text || "(empty)"}`);
    parts.push("");
  }
  return parts.join("\n").trimEnd();
}

function formatDecisionDetail(
  detail: DecisionDetail | null,
  requestedId: string,
): string {
  if (detail === null) return `Decision not found: ${requestedId}`;
  const lines: string[] = [];
  lines.push(`# ${detail.title}`);
  lines.push(`- **ID:** ${detail.id}`);
  lines.push(`- **Topic:** ${detail.topic_title} (${detail.topic_id})`);
  lines.push(`- **Status:** ${detail.status}`);
  lines.push("");
  lines.push("## Context");
  lines.push(detail.context_text || "(empty)");
  lines.push("");
  lines.push("## Decision");
  lines.push(detail.decision_text || "(empty)");
  if (detail.decision_rationale) {
    lines.push("");
    lines.push(`**Rationale:** ${detail.decision_rationale}`);
  }
  if (detail.alternatives.length > 0) {
    lines.push("");
    lines.push("## Alternatives");
    for (const alt of detail.alternatives) {
      lines.push(`### Option ${alt.option_index}`);
      lines.push(alt.text);
      if (alt.rationale) lines.push(`**Rationale:** ${alt.rationale}`);
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd();
}

function formatTopicList(
  topics: TopicOverview[],
  parentId: string | null,
): string {
  const header = parentId === null
    ? "# Root topics"
    : `# Subtopics of ${parentId}`;
  if (topics.length === 0) {
    return `${header}\n\n(none)`;
  }
  const parts: string[] = [header, ""];
  for (const t of topics) {
    const pathLine = t.path.length > 0 ? t.path.join(" / ") : "(root)";
    parts.push(`## ${t.title}`);
    parts.push(`- **ID:** ${t.id}`);
    parts.push(`- **Path:** ${pathLine}`);
    parts.push(`- **Has subtopics:** ${t.has_subtopics ? "yes" : "no"}`);
    parts.push(`- **Short summary:** ${t.short_summary || "(empty)"}`);
    if (t.long_summary) {
      parts.push(`- **Long summary:** ${t.long_summary}`);
    }
    parts.push("");
  }
  return parts.join("\n").trimEnd();
}
