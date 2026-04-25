import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TopicItemSchema } from "../../../../shared-contracts/topics.js";
import {
  runFileOutputTool,
  runInlineJsonTool,
} from "../../mcp-tool-output.js";
import type { TopicDetail, TopicOverview } from "./topics.repository.js";
import { TopicsService } from "./topics.service.js";

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
