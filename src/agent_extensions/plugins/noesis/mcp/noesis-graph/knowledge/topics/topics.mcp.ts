import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TopicItemSchema } from "../../../../shared-contracts/topics.js";
import {
  runFileOutputTool,
  runInlineJsonTool,
} from "../../mcp-tool-output.js";
import type {
  TopicDetail,
  TopicItemEntry,
  TopicOverview,
} from "./topics.repository.js";
import { TopicsService, type TopicSummaryWithPath } from "./topics.service.js";

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

export function registerTopicsTools(
  mcp: McpServer,
  topics: TopicsService,
): void {
  registerAddTopic(mcp, topics);
  registerAddSubtopic(mcp, topics);
  registerReparentTopic(mcp, topics);
  registerAddItemsToTopic(mcp, topics);
  registerListTopics(mcp, topics);
  registerReadTopic(mcp, topics);
  registerListTopicSummariesForSources(mcp, topics);
  registerListTopicItemsSince(mcp, topics);
}

function registerAddItemsToTopic(
  mcp: McpServer,
  topics: TopicsService,
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
      runInlineJsonTool(() => topics.addItemsToTopic(topic_id, items)),
  );
}

function registerAddSubtopic(mcp: McpServer, topics: TopicsService): void {
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
        topics.addSubtopic(parent_topic_id, {
          id,
          title,
          short_summary,
          long_summary,
        }),
      ),
  );
}

function registerAddTopic(mcp: McpServer, topics: TopicsService): void {
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
        topics.addTopic({ id, title, short_summary, long_summary }),
      ),
  );
}

function registerListTopics(mcp: McpServer, topics: TopicsService): void {
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
        () => topics.listTopics(parent_topic_id ?? null),
        (rows) => formatTopicList(rows, parent_topic_id ?? null),
      ),
  );
}

function registerReadTopic(mcp: McpServer, topics: TopicsService): void {
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
        () => topics.readTopic(topic_id),
        (topic) => formatTopicDetail(topic, topic_id),
      ),
  );
}

function registerReparentTopic(mcp: McpServer, topics: TopicsService): void {
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
        topics.reparentTopic(topic_id, new_parent_topic_id),
      ),
  );
}

function registerListTopicSummariesForSources(
  mcp: McpServer,
  topics: TopicsService,
): void {
  mcp.registerTool(
    "list_topic_summaries_for_sources",
    {
      description:
        "List Topics whose IdeaUnits or DocumentFragments come from the given Conversations or Documents. " +
        "Writes Markdown (one section per topic: id, path, short summary, long summary) to a tmp file " +
        "and returns the file path — read it with the Read tool.",
      inputSchema: {
        conversation_ids: z
          .array(z.string())
          .default([])
          .describe("Conversation ids whose linked topics should be returned."),
        document_ids: z
          .array(z.string())
          .default([])
          .describe("Document ids whose linked topics should be returned."),
      },
    },
    async ({ conversation_ids, document_ids }) =>
      runFileOutputTool(
        "list_topic_summaries_for_sources",
        () =>
          topics.listTopicSummariesForSources(
            conversation_ids ?? [],
            document_ids ?? [],
          ),
        (rows) =>
          formatTopicSummariesForSources(
            rows,
            conversation_ids ?? [],
            document_ids ?? [],
          ),
      ),
  );
}

function registerListTopicItemsSince(
  mcp: McpServer,
  topics: TopicsService,
): void {
  mcp.registerTool(
    "list_topic_items_since",
    {
      description:
        "Load supporting items (IdeaUnits and DocumentFragments) attached to a Topic, optionally " +
        "filtered to those whose source (conversation time or document date) is strictly after `since`. " +
        "Writes Markdown grouped by source to a tmp file and returns the file path — read it with the Read tool.",
      inputSchema: {
        topic_id: z.string().describe("Id of the Topic to load items for."),
        since: z
          .string()
          .nullable()
          .optional()
          .describe(
            "ISO timestamp (e.g. '2026-04-01' or '2026-04-01T00:00:00Z'). " +
              "When provided, only items with a source date strictly greater than this value are returned. " +
              "Compared lexicographically — use the same format as Conversation.time / Document.date.",
          ),
      },
    },
    async ({ topic_id, since }) =>
      runFileOutputTool(
        "list_topic_items_since",
        () => topics.listTopicItemsSince(topic_id, since ?? null),
        (entries) =>
          formatTopicItemsSince(topic_id, since ?? null, entries),
      ),
  );
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

function formatTopicSummariesForSources(
  rows: TopicSummaryWithPath[],
  conversationIds: string[],
  documentIds: string[],
): string {
  const header =
    `# Topics for sources\n` +
    `- **Conversations:** ${conversationIds.length === 0 ? "(none)" : conversationIds.join(", ")}\n` +
    `- **Documents:** ${documentIds.length === 0 ? "(none)" : documentIds.join(", ")}`;
  if (rows.length === 0) {
    return `${header}\n\n(no topics linked to these sources)`;
  }
  const parts: string[] = [header, ""];
  for (const row of rows) {
    const pathLine = row.path.length > 0 ? row.path.join(" / ") : "(root)";
    parts.push(`## ${row.title}`);
    parts.push(`- **ID:** ${row.id}`);
    parts.push(`- **Path:** ${pathLine}`);
    parts.push(`- **Short summary:** ${row.short_summary || "(empty)"}`);
    parts.push("");
    parts.push("### Long summary");
    parts.push("");
    parts.push(row.long_summary || "(empty)");
    parts.push("");
  }
  return parts.join("\n").trimEnd();
}

function formatTopicItemsSince(
  topicId: string,
  since: string | null,
  entries: TopicItemEntry[],
): string {
  const header =
    `# Topic items: ${topicId}\n` +
    `- **Since:** ${since ?? "(no filter — all items)"}`;
  if (entries.length === 0) {
    return `${header}\n\n(no items match)`;
  }
  const ideaUnits = entries.filter(
    (e): e is Extract<TopicItemEntry, { type: "idea_unit" }> =>
      e.type === "idea_unit",
  );
  const fragments = entries.filter(
    (e): e is Extract<TopicItemEntry, { type: "document_fragment" }> =>
      e.type === "document_fragment",
  );
  const parts: string[] = [header, ""];
  if (ideaUnits.length > 0) {
    parts.push("## Idea Units");
    parts.push("");
    const byConversation = new Map<
      string,
      Extract<TopicItemEntry, { type: "idea_unit" }>[]
    >();
    for (const iu of ideaUnits) {
      const list = byConversation.get(iu.conversation_id) ?? [];
      list.push(iu);
      byConversation.set(iu.conversation_id, list);
    }
    for (const [convId, items] of byConversation) {
      const head = items[0];
      parts.push(
        `### Conversation: ${head.conversation_main_topic} (${convId}) — ${head.conversation_time}`,
      );
      for (const iu of items) {
        const cats = iu.categories.join(", ");
        parts.push(
          `- **[T${iu.turn_index}:IU${iu.idea_unit_index}]** ${iu.time} — ${iu.speaker} [${cats}]`,
        );
        parts.push(`  ${iu.sentences.join(" ")}`);
      }
      parts.push("");
    }
  }
  if (fragments.length > 0) {
    parts.push("## Document Fragments");
    parts.push("");
    const byDocument = new Map<
      string,
      Extract<TopicItemEntry, { type: "document_fragment" }>[]
    >();
    for (const f of fragments) {
      const list = byDocument.get(f.document_id) ?? [];
      list.push(f);
      byDocument.set(f.document_id, list);
    }
    for (const [docId, items] of byDocument) {
      const head = items[0];
      parts.push(
        `### Document: ${head.document_title} (${docId}) — ${head.document_date}`,
      );
      for (const f of items) {
        parts.push(`- **[${f.start_offset}–${f.end_offset}]**`);
        parts.push(`  ${f.text}`);
      }
      parts.push("");
    }
  }
  return parts.join("\n").trimEnd();
}
