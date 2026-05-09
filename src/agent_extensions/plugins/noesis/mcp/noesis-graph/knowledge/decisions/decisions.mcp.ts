import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runFileOutputTool } from "../../mcp-tool-output.js";
import {
  DecisionsService,
  type DecisionDetail,
  type DecisionOverview,
} from "./decisions.service.js";

export function registerDecisionsTools(
  mcp: McpServer,
  decisions: DecisionsService,
): void {
  registerListDecisions(mcp, decisions);
  registerReadDecision(mcp, decisions);
  registerListDecisionsForSources(mcp, decisions);
}

function registerListDecisions(
  mcp: McpServer,
  decisions: DecisionsService,
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
        () => decisions.listDecisions(topic_id ?? null),
        (rows) => formatDecisionList(rows, topic_id ?? null),
      ),
  );
}

function registerReadDecision(
  mcp: McpServer,
  decisions: DecisionsService,
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
        () => decisions.readDecision(decision_id),
        (detail) => formatDecisionDetail(detail, decision_id),
      ),
  );
}

function registerListDecisionsForSources(
  mcp: McpServer,
  decisions: DecisionsService,
): void {
  mcp.registerTool(
    "list_decisions_for_sources",
    {
      description:
        "List Decisions whose supporting items reference any of the given Conversations or Documents. " +
        "Writes Markdown (one section per decision: title, status, context, decision text, rationale, " +
        "alternatives) to a tmp file and returns the file path — read it with the Read tool.",
      inputSchema: {
        conversation_ids: z
          .array(z.string())
          .default([])
          .describe("Conversation ids whose decisions should be returned."),
        document_ids: z
          .array(z.string())
          .default([])
          .describe("Document ids whose decisions should be returned."),
      },
    },
    async ({ conversation_ids, document_ids }) =>
      runFileOutputTool(
        "list_decisions_for_sources",
        () =>
          decisions.listDecisionsForSources(
            conversation_ids ?? [],
            document_ids ?? [],
          ),
        (rows) =>
          formatDecisionsForSources(
            rows,
            conversation_ids ?? [],
            document_ids ?? [],
          ),
      ),
  );
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

function formatDecisionsForSources(
  details: DecisionDetail[],
  conversationIds: string[],
  documentIds: string[],
): string {
  const header =
    `# Decisions for sources\n` +
    `- **Conversations:** ${conversationIds.length === 0 ? "(none)" : conversationIds.join(", ")}\n` +
    `- **Documents:** ${documentIds.length === 0 ? "(none)" : documentIds.join(", ")}`;
  if (details.length === 0) {
    return `${header}\n\n(no decisions linked to these sources)`;
  }
  const parts: string[] = [header, ""];
  for (const detail of details) {
    parts.push(`## ${detail.title}`);
    parts.push(`- **ID:** ${detail.id}`);
    parts.push(`- **Topic:** ${detail.topic_title} (${detail.topic_id})`);
    parts.push(`- **Status:** ${detail.status}`);
    parts.push("");
    parts.push("### Context");
    parts.push(detail.context_text || "(empty)");
    parts.push("");
    parts.push("### Decision");
    parts.push(detail.decision_text || "(empty)");
    if (detail.decision_rationale) {
      parts.push("");
      parts.push(`**Rationale:** ${detail.decision_rationale}`);
    }
    if (detail.alternatives.length > 0) {
      parts.push("");
      parts.push("### Alternatives");
      for (const alt of detail.alternatives) {
        parts.push(`#### Option ${alt.option_index}`);
        parts.push(alt.text);
        if (alt.rationale) parts.push(`**Rationale:** ${alt.rationale}`);
        parts.push("");
      }
    }
    parts.push("");
  }
  return parts.join("\n").trimEnd();
}

function formatDecisionList(
  decisions: DecisionOverview[],
  topicId: string | null,
): string {
  const header =
    topicId === null ? "# All decisions" : `# Decisions for topic ${topicId}`;
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
