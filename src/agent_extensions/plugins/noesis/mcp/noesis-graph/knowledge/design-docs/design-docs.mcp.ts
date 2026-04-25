import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type {
  DesignDoc,
  DesignDocOverview,
  DesignedActor,
  DesignedBehaviour,
  DesignedBoundedContext,
  DesignedBuildingBlock,
  DesignedDomainModule,
  DesignedQualityAttribute,
  DesignedRule,
  DesignedScenario,
} from "../../../../shared-contracts/design-doc.js";
import { DesignDocsService } from "./design-docs.service.js";
import {
  runFileOutputTool,
  runInlineJsonTool,
} from "../../mcp-tool-output.js";

export function registerDesignDocsTools(
  mcp: McpServer,
  service: DesignDocsService,
): void {
  registerSaveDesignDoc(mcp, service);
  registerReadDesignDoc(mcp, service);
  registerListDesignDocs(mcp, service);
  registerDeleteDesignDoc(mcp, service);
}

function registerSaveDesignDoc(
  mcp: McpServer,
  service: DesignDocsService,
): void {
  mcp.registerTool(
    "save_design_doc",
    {
      description:
        "Persist a DesignDoc into the knowledge graph from a JSON file matching DesignDocSchema. " +
        "Applies ChangeSets recursively (added → upsert, modified → partial update, removed → delete by name). " +
        "If `output_path` is provided, the validated, normalized JSON is also written there for version control. " +
        "Returns inline JSON with counts of items added/modified/removed at each top-level slot.",
      inputSchema: {
        input_path: z
          .string()
          .describe("Absolute path to a JSON file matching DesignDocSchema."),
        output_path: z
          .string()
          .nullable()
          .optional()
          .describe(
            "Optional absolute path. When set, the normalized DesignDoc JSON is written there.",
          ),
      },
    },
    async ({ input_path, output_path }) =>
      runInlineJsonTool(() =>
        service.saveDesignDocFromFile(input_path, output_path ?? null),
      ),
  );
}

function registerReadDesignDoc(
  mcp: McpServer,
  service: DesignDocsService,
): void {
  mcp.registerTool(
    "read_design_doc",
    {
      description:
        "Read the full current state of a DesignDoc by id. Writes a Markdown rendering " +
        "(actors, bounded contexts → modules → building blocks → behaviours/rules/scenarios, quality attributes) " +
        "to a tmp file and returns the file path. Read it with the Read tool.",
      inputSchema: {
        design_doc_id: z.string().describe("Id of the DesignDoc to read."),
      },
    },
    async ({ design_doc_id }) =>
      runFileOutputTool(
        "read_design_doc",
        () => service.readDesignDoc(design_doc_id),
        (doc) => formatDesignDoc(doc, design_doc_id),
      ),
  );
}

function registerListDesignDocs(
  mcp: McpServer,
  service: DesignDocsService,
): void {
  mcp.registerTool(
    "list_design_docs",
    {
      description:
        "List all DesignDocs in the knowledge graph (id, name, description, counts). " +
        "Writes Markdown to a tmp file and returns the file path — read it with the Read tool.",
      inputSchema: {},
    },
    async () =>
      runFileOutputTool(
        "list_design_docs",
        () => service.listDesignDocs(),
        formatDesignDocList,
      ),
  );
}

function registerDeleteDesignDoc(
  mcp: McpServer,
  service: DesignDocsService,
): void {
  mcp.registerTool(
    "delete_design_doc",
    {
      description:
        "Remove a DesignDoc and all its descendants (actors, bounded contexts, modules, " +
        "building blocks, behaviours, rules, scenarios, quality attributes) from the graph.",
      inputSchema: {
        design_doc_id: z.string().describe("Id of the DesignDoc to delete."),
      },
    },
    async ({ design_doc_id }) =>
      runInlineJsonTool(() => service.deleteDesignDoc(design_doc_id)),
  );
}

function formatDesignDoc(
  doc: DesignDoc | null,
  requestedId: string,
): string {
  if (doc === null) return `DesignDoc not found: ${requestedId}`;
  const lines: string[] = [];
  lines.push(`# ${doc.name}`);
  lines.push(`- **ID:** ${doc.id}`);
  lines.push(`- **Description:** ${doc.description}`);
  lines.push("");

  appendActors(lines, doc.actors?.added ?? []);
  appendQualityAttributes(lines, doc.qualityAttributes?.added ?? []);
  appendBoundedContexts(lines, doc.boundedContexts?.added ?? []);

  return lines.join("\n").trimEnd();
}

function appendActors(lines: string[], actors: DesignedActor[]): void {
  lines.push("## Actors");
  lines.push("");
  if (actors.length === 0) {
    lines.push("(none)");
    lines.push("");
    return;
  }
  for (const a of actors) {
    lines.push(`- **${a.name}** — ${a.description ?? ""}`);
  }
  lines.push("");
}

function appendQualityAttributes(
  lines: string[],
  attrs: DesignedQualityAttribute[],
): void {
  lines.push("## Quality Attributes");
  lines.push("");
  if (attrs.length === 0) {
    lines.push("(none)");
    lines.push("");
    return;
  }
  for (const q of attrs) {
    const type = q.type ? ` _(${q.type})_` : "";
    lines.push(`- **${q.name}**${type} — ${q.description ?? ""}`);
  }
  lines.push("");
}

function appendBoundedContexts(
  lines: string[],
  contexts: DesignedBoundedContext[],
): void {
  lines.push("## Bounded Contexts");
  lines.push("");
  if (contexts.length === 0) {
    lines.push("(none)");
    return;
  }
  for (const bc of contexts) {
    lines.push(`### ${bc.name}`);
    if (bc.description) lines.push(bc.description);
    lines.push("");
    for (const m of bc.modules?.added ?? []) {
      appendModule(lines, m, 4);
    }
    for (const bb of bc.buildingBlocks?.added ?? []) {
      appendBuildingBlock(lines, bb, 4);
    }
  }
}

function appendModule(
  lines: string[],
  mod: DesignedDomainModule,
  headingLevel: number,
): void {
  lines.push(`${"#".repeat(headingLevel)} Module: ${mod.name}`);
  if (mod.description) lines.push(mod.description);
  lines.push("");
  for (const bb of mod.buildingBlocks?.added ?? []) {
    appendBuildingBlock(lines, bb, headingLevel + 1);
  }
}

function appendBuildingBlock(
  lines: string[],
  bb: DesignedBuildingBlock,
  headingLevel: number,
): void {
  const type = bb.type ? ` _(${bb.type})_` : "";
  lines.push(`${"#".repeat(headingLevel)} ${bb.name}${type}`);
  if (bb.description) lines.push(bb.description);
  const properties = bb.properties?.added ?? [];
  if (properties.length > 0) {
    lines.push("");
    lines.push("**Properties:**");
    for (const p of properties) {
      lines.push(`- ${p.name}${p.type ? `: ${p.type}` : ""}`);
    }
  }
  for (const bh of bb.behaviours?.added ?? []) {
    appendBehaviour(lines, bh, headingLevel + 1);
  }
  for (const r of bb.rules?.added ?? []) {
    appendRule(lines, r);
  }
  for (const s of bb.scenarios?.added ?? []) {
    appendScenario(lines, s);
  }
  lines.push("");
}

function appendBehaviour(
  lines: string[],
  bh: DesignedBehaviour,
  headingLevel: number,
): void {
  const tag = bh.type ? ` _[${bh.type}]_` : "";
  const visibility = bh.isPublic ? " · public" : "";
  lines.push(`${"#".repeat(headingLevel)} ${bh.name}${tag}${visibility}`);
  if (bh.description) lines.push(bh.description);
  if (bh.actor) lines.push(`- **Actor:** ${bh.actor}`);
  const inputs = bh.input?.added ?? [];
  const outputs = bh.output?.added ?? [];
  const used = bh.usedBuildingBlocks?.added ?? [];
  if (inputs.length > 0) lines.push(`- **Input:** ${inputs.join(", ")}`);
  if (outputs.length > 0) lines.push(`- **Output:** ${outputs.join(", ")}`);
  if (used.length > 0) lines.push(`- **Uses:** ${used.join(", ")}`);
  for (const r of bh.rules?.added ?? []) appendRule(lines, r);
  for (const s of bh.scenarios?.added ?? []) appendScenario(lines, s);
  lines.push("");
}

function appendRule(lines: string[], rule: DesignedRule): void {
  const type = rule.ruleType ? ` _(${rule.ruleType})_` : "";
  lines.push(`- **Rule:** ${rule.name}${type}${rule.description ? ` — ${rule.description}` : ""}`);
}

function appendScenario(lines: string[], scenario: DesignedScenario): void {
  lines.push(`- **Scenario:** ${scenario.name} — ${scenario.description}`);
  lines.push(`  - Given: ${scenario.given}`);
  lines.push(`  - When: ${scenario.when}`);
  lines.push(`  - Then: ${scenario.then}`);
}

function formatDesignDocList(docs: DesignDocOverview[]): string {
  if (docs.length === 0) {
    return "# Design Docs\n\n(none)";
  }
  const parts: string[] = ["# Design Docs", ""];
  for (const d of docs) {
    parts.push(`## ${d.name}`);
    parts.push(`- **ID:** ${d.id}`);
    parts.push(`- **Description:** ${d.description}`);
    parts.push(
      `- **Counts:** ${d.actor_count} actors, ${d.bounded_context_count} bounded contexts, ${d.quality_attribute_count} quality attributes`,
    );
    parts.push("");
  }
  return parts.join("\n").trimEnd();
}
