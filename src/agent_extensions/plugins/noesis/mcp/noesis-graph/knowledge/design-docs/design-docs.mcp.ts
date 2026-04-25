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
import type {
  BoundedContextMapEntry,
  ModelTarget,
} from "./design-docs.repository.js";
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
  registerReadBoundedContextMap(mcp, service);
  registerReadModelForModules(mcp, service);
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
        "The path points at the version-controlled DesignDoc JSON in the repository — the agent writes/updates this file " +
        "directly, then this tool reads it, validates, and applies ChangeSets recursively (added → upsert, " +
        "modified → partial update, removed → delete by name). Returns the design doc id and aggregate counts.",
      inputSchema: {
        path: z
          .string()
          .describe(
            "Absolute path to the persisted DesignDoc JSON file in the repository.",
          ),
      },
    },
    async ({ path }) =>
      runInlineJsonTool(() => service.saveDesignDocFromFile(path)),
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

function registerReadBoundedContextMap(
  mcp: McpServer,
  service: DesignDocsService,
): void {
  mcp.registerTool(
    "read_bounded_context_map",
    {
      description:
        "Return a hierarchical Markdown map of every Bounded Context across all Design Docs " +
        "with their Modules. Result is returned inline (small payload) — no tmp file.",
      inputSchema: {},
    },
    async () =>
      runInlineJsonTool(async () => ({
        markdown: formatBoundedContextMap(await service.readBoundedContextMap()),
      })),
  );
}

function registerReadModelForModules(
  mcp: McpServer,
  service: DesignDocsService,
): void {
  mcp.registerTool(
    "read_model_for_modules",
    {
      description:
        "Render the existing model (Bounded Context → Module → Building Block → Behaviour, with rules and scenarios) " +
        "for the listed targets. Each target picks one Bounded Context within a Design Doc, optionally narrowed to " +
        "a single Module. Writes Markdown to a tmp file and returns the file path — read it with the Read tool.",
      inputSchema: {
        targets: z
          .array(
            z.object({
              design_doc_id: z
                .string()
                .describe("Design Doc id from the BC map."),
              bounded_context_name: z
                .string()
                .describe("Bounded Context name as listed in the BC map."),
              module_name: z
                .string()
                .nullable()
                .optional()
                .describe(
                  "Optional module name. When provided, only that module is included; " +
                    "otherwise the whole Bounded Context is rendered.",
                ),
            }),
          )
          .describe("Bounded Contexts (and optionally Modules) to render."),
      },
    },
    async ({ targets }) =>
      runFileOutputTool(
        "read_model_for_modules",
        () =>
          service.readModelForTargets(
            targets.map((t): ModelTarget => ({
              design_doc_id: t.design_doc_id,
              bounded_context_name: t.bounded_context_name,
              module_name: t.module_name ?? null,
            })),
          ),
        (contexts) =>
          formatModelForModules(
            contexts,
            targets.map((t) => ({
              design_doc_id: t.design_doc_id,
              bounded_context_name: t.bounded_context_name,
              module_name: t.module_name ?? null,
            })),
          ),
      ),
  );
}

function formatBoundedContextMap(entries: BoundedContextMapEntry[]): string {
  if (entries.length === 0) {
    return "# Bounded Context map\n\n(no design docs in the graph yet)";
  }
  const byDesignDoc = new Map<
    string,
    { name: string; entries: BoundedContextMapEntry[] }
  >();
  for (const entry of entries) {
    const slot = byDesignDoc.get(entry.design_doc_id) ?? {
      name: entry.design_doc_name,
      entries: [],
    };
    slot.entries.push(entry);
    byDesignDoc.set(entry.design_doc_id, slot);
  }
  const parts: string[] = ["# Bounded Context map", ""];
  for (const [designDocId, group] of byDesignDoc) {
    parts.push(`## ${group.name} (design_doc_id: ${designDocId})`);
    parts.push("");
    for (const bc of group.entries) {
      parts.push(`- **${bc.bounded_context_name}**${bc.description ? ` — ${bc.description}` : ""}`);
      for (const mod of bc.modules) {
        parts.push(`  - Module: ${mod.name}${mod.description ? ` — ${mod.description}` : ""}`);
      }
    }
    parts.push("");
  }
  parts.push("## Relations");
  parts.push("");
  parts.push("(no Bounded Context relations modelled in the graph yet)");
  return parts.join("\n").trimEnd();
}

function formatModelForModules(
  contexts: DesignedBoundedContext[],
  targets: ModelTarget[],
): string {
  const parts: string[] = ["# Model for selected modules", ""];
  parts.push("**Targets:**");
  for (const t of targets) {
    const moduleSuffix = t.module_name ? ` / ${t.module_name}` : "";
    parts.push(
      `- ${t.bounded_context_name}${moduleSuffix} _(design_doc_id: ${t.design_doc_id})_`,
    );
  }
  parts.push("");
  if (contexts.length === 0) {
    parts.push("(no matching Bounded Contexts found)");
    return parts.join("\n").trimEnd();
  }
  for (const bc of contexts) {
    parts.push(`## ${bc.name}`);
    if (bc.description) parts.push(bc.description);
    parts.push("");
    for (const m of bc.modules?.added ?? []) {
      appendModule(parts, m, 3);
    }
    for (const bb of bc.buildingBlocks?.added ?? []) {
      appendBuildingBlock(parts, bb, 3);
    }
  }
  return parts.join("\n").trimEnd();
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
