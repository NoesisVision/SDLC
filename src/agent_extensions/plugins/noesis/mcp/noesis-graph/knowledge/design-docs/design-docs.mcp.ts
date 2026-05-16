import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type {
  DesignDocFile,
  DesignedActor,
  DesignedBehaviour,
  DesignedBoundedContext,
  DesignedBuildingBlock,
  DesignedDomainModule,
  DesignedQualityAttribute,
  DesignedRule,
  DesignedScenario,
} from "../../../../shared-contracts/design-doc.js";
import {
  runFileOutputTool,
  runInlineJsonTool,
} from "../../mcp-tool-output.js";
import { ConfirmedEditSchema } from "../locks.js";
import {
  DesignDocImplementedError,
  DesignDocsService,
  type BoundedContextMapEntry,
  type DesignDocOverview,
  type ModelTarget,
} from "./design-docs.service.js";

export function registerDesignDocsTools(
  mcp: McpServer,
  service: DesignDocsService,
): void {
  registerPrepareDesignDocPath(mcp, service);
  registerSaveDesignDoc(mcp, service);
  registerReadDesignDoc(mcp, service);
  registerListDesignDocs(mcp, service);
  registerDeleteDesignDoc(mcp, service);
  registerReadBoundedContextMap(mcp, service);
  registerReadModelForModules(mcp, service);
  registerMarkDesignDocImplemented(mcp, service);
  registerListActors(mcp, service);
  registerUpsertActor(mcp, service);
}

function registerPrepareDesignDocPath(
  mcp: McpServer,
  service: DesignDocsService,
): void {
  mcp.registerTool(
    "prepare_design_doc_path",
    {
      description:
        "Mint (or accept) a DesignDoc id and return the canonical file path the agent must write to. " +
        "Filename is `<slug-up-to-20>-<id-suffix>.json` under `<projectDir>/noesis/design-docs/`. " +
        "When iterating an existing doc, pass its known `id`. " +
        "Returns `{ status: \"Ok\", id, canonical_path }` for active docs, or " +
        "`{ status: \"AlreadyImplemented\", design_doc_id, name }` when the supplied id is already implemented.",
      inputSchema: {
        name: z.string().describe("DesignDoc name (drives the filename slug)."),
        id: z
          .string()
          .optional()
          .describe(
            "Existing DesignDoc id (omit for a new doc — a UUID will be minted).",
          ),
      },
    },
    async ({ name, id }) =>
      runInlineJsonTool(() =>
        service.prepareDesignDocPath({ name, id: id ?? undefined }),
      ),
  );
}

function registerSaveDesignDoc(
  mcp: McpServer,
  service: DesignDocsService,
): void {
  mcp.registerTool(
    "save_design_doc",
    {
      description:
        "Persist a DesignDoc into the knowledge graph from a JSON file matching DesignDocFileSchema. " +
        "Path MUST be the canonical path returned by `prepare_design_doc_path`. " +
        "If the prior on-disk version of the doc has any user-edited (`*_locked: true`) top-level field " +
        "(`name`, `description`) whose value would change, the save rejects with the locked-field list; " +
        "re-call with `confirmed_edits` listing only the locks the user explicitly approved to overwrite. " +
        "When the targeted doc has already been marked implemented, returns " +
        "`{ status: \"AlreadyImplemented\", design_doc_id, name }` instead of saving.",
      inputSchema: {
        path: z
          .string()
          .describe(
            "Absolute canonical path returned by `prepare_design_doc_path`.",
          ),
        confirmed_edits: z
          .array(ConfirmedEditSchema)
          .optional()
          .describe(
            "Locked-field overrides the user has explicitly approved. Each entry is " +
              "`{ kind: 'design_doc', design_doc_id, field: 'name'|'description' }`. " +
              "Required only when a previous call rejected with locked-field conflicts.",
          ),
      },
    },
    async ({ path, confirmed_edits }) =>
      runInlineJsonTool(async () => {
        try {
          return await service.saveFromFile(path, confirmed_edits ?? []);
        } catch (err) {
          if (err instanceof DesignDocImplementedError) {
            return {
              status: "AlreadyImplemented" as const,
              design_doc_id: err.designDocId,
              name: err.designDocName,
            };
          }
          throw err;
        }
      }),
  );
}

function registerMarkDesignDocImplemented(
  mcp: McpServer,
  service: DesignDocsService,
): void {
  mcp.registerTool(
    "mark_design_doc_implemented",
    {
      description:
        "Seal a DesignDoc as implemented. Idempotent: a no-op when the doc is already implemented. " +
        "From this point save_design_doc, prepare_design_doc_path (with this id), and the UI editor refuse to mutate the doc.",
      inputSchema: {
        design_doc_id: z.string().describe("Id of the DesignDoc."),
      },
    },
    async ({ design_doc_id }) =>
      runInlineJsonTool(() => service.markImplemented(design_doc_id)),
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
        "Read the full current state of a DesignDoc by id. Writes a Markdown rendering to a tmp file " +
        "and returns the file path. Read it with the Read tool.",
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
        "List all DesignDocs in the knowledge graph. Writes Markdown to a tmp file and returns the file path.",
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
        "Remove a DesignDoc and all its descendants from the graph and disk. " +
        "Graph-global actors are not deleted.",
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
        "Return a hierarchical Markdown map of every Bounded Context across all Design Docs with their Modules. " +
        "Result is returned inline (small payload).",
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
        "Render the existing model for the listed targets. Writes Markdown to a tmp file.",
      inputSchema: {
        targets: z
          .array(
            z.object({
              design_doc_id: z.string(),
              bounded_context_name: z.string(),
              module_name: z.string().nullable().optional(),
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

function registerListActors(
  mcp: McpServer,
  service: DesignDocsService,
): void {
  mcp.registerTool(
    "list_actors",
    {
      description: "Return the graph-global actor catalog. Result is returned inline.",
      inputSchema: {},
    },
    async () =>
      runInlineJsonTool(async () => ({
        actors: await service.listActors(),
      })),
  );
}

function registerUpsertActor(
  mcp: McpServer,
  service: DesignDocsService,
): void {
  mcp.registerTool(
    "upsert_actor",
    {
      description:
        "Create or update a graph-global actor. Returns `{ status: \"Ok\", name }`.",
      inputSchema: {
        name: z.string().describe("Actor name (graph-global identity)."),
        description: z
          .string()
          .nullable()
          .optional()
          .describe("One-line description of the actor's role."),
      },
    },
    async ({ name, description }) =>
      runInlineJsonTool(() =>
        service.upsertActor({
          name,
          description: description ?? null,
        }),
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
      parts.push(
        `- **${bc.bounded_context_name}**${bc.description ? ` — ${bc.description}` : ""}`,
      );
      for (const mod of bc.modules) {
        parts.push(
          `  - Module: ${mod.name}${mod.description ? ` — ${mod.description}` : ""}`,
        );
      }
    }
    parts.push("");
  }
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
    appendQualityAttributes(parts, bc.qualityAttributes?.added ?? []);
    parts.push("");
    for (const m of bc.modules?.added ?? []) appendModule(parts, m, 3);
    for (const bb of bc.buildingBlocks?.added ?? []) appendBuildingBlock(parts, bb, 3);
  }
  return parts.join("\n").trimEnd();
}

function formatDesignDoc(
  doc: DesignDocFile | null,
  requestedId: string,
): string {
  if (doc === null) return `DesignDoc not found: ${requestedId}`;
  const lines: string[] = [];
  lines.push(`# ${doc.name}`);
  lines.push(`- **ID:** ${doc.id}`);
  lines.push(`- **Description:** ${doc.description}`);
  lines.push(`- **Implemented:** ${doc.implemented ? "yes" : "no"}`);
  lines.push("");
  appendBoundedContexts(lines, doc.boundedContexts?.added ?? []);
  return lines.join("\n").trimEnd();
}

function formatDesignDocList(docs: DesignDocOverview[]): string {
  if (docs.length === 0) return "# Design Docs\n\n(none)";
  const parts: string[] = ["# Design Docs", ""];
  for (const d of docs) {
    parts.push(`## ${d.name}`);
    parts.push(`- **ID:** ${d.id}`);
    parts.push(`- **Description:** ${d.description}`);
    parts.push(`- **Implemented:** ${d.implemented ? "yes" : "no"}`);
    parts.push(`- **Bounded contexts:** ${d.bounded_context_count}`);
    parts.push("");
  }
  return parts.join("\n").trimEnd();
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
    appendQualityAttributes(lines, bc.qualityAttributes?.added ?? []);
    lines.push("");
    for (const m of bc.modules?.added ?? []) appendModule(lines, m, 4);
    for (const bb of bc.buildingBlocks?.added ?? []) appendBuildingBlock(lines, bb, 4);
  }
}

function appendModule(
  lines: string[],
  mod: DesignedDomainModule,
  level: number,
): void {
  lines.push(`${"#".repeat(level)} Module: ${mod.name}`);
  if (mod.description) lines.push(mod.description);
  appendQualityAttributes(lines, mod.qualityAttributes?.added ?? []);
  lines.push("");
  for (const bb of mod.buildingBlocks?.added ?? []) appendBuildingBlock(lines, bb, level + 1);
}

function appendBuildingBlock(
  lines: string[],
  bb: DesignedBuildingBlock,
  level: number,
): void {
  const type = bb.type ? ` _(${bb.type})_` : "";
  lines.push(`${"#".repeat(level)} ${bb.name}${type}`);
  if (bb.description) lines.push(bb.description);
  const properties = bb.properties?.added ?? [];
  if (properties.length > 0) {
    lines.push("");
    lines.push("**Properties:**");
    for (const p of properties) {
      lines.push(`- ${p.name}${p.type ? `: ${p.type}` : ""}`);
    }
  }
  appendQualityAttributes(lines, bb.qualityAttributes?.added ?? []);
  for (const bh of bb.behaviours?.added ?? []) appendBehaviour(lines, bh, level + 1);
  for (const r of bb.rules?.added ?? []) appendRule(lines, r);
  for (const s of bb.scenarios?.added ?? []) appendScenario(lines, s);
  lines.push("");
}

function appendBehaviour(
  lines: string[],
  bh: DesignedBehaviour,
  level: number,
): void {
  const tag = bh.type ? ` _[${bh.type}]_` : "";
  const visibility = bh.isPublic ? " · public" : "";
  lines.push(`${"#".repeat(level)} ${bh.name}${tag}${visibility}`);
  if (bh.description) lines.push(bh.description);
  if (bh.actor) lines.push(`- **Actor:** ${bh.actor}`);
  const inputs = bh.input?.added ?? [];
  const outputs = bh.output?.added ?? [];
  const used = bh.usedBuildingBlocks?.added ?? [];
  if (inputs.length > 0) lines.push(`- **Input:** ${inputs.join(", ")}`);
  if (outputs.length > 0) lines.push(`- **Output:** ${outputs.join(", ")}`);
  if (used.length > 0) lines.push(`- **Uses:** ${used.join(", ")}`);
  appendQualityAttributes(lines, bh.qualityAttributes?.added ?? []);
  for (const r of bh.rules?.added ?? []) appendRule(lines, r);
  for (const s of bh.scenarios?.added ?? []) appendScenario(lines, s);
  lines.push("");
}

function appendQualityAttributes(
  lines: string[],
  attrs: DesignedQualityAttribute[],
): void {
  if (attrs.length === 0) return;
  lines.push("");
  lines.push("**Quality Attributes:**");
  for (const q of attrs) {
    const type = q.type ? ` _(${q.type})_` : "";
    lines.push(`- **${q.name}**${type} — ${q.description ?? ""}`);
  }
}

function appendRule(lines: string[], rule: DesignedRule): void {
  const type = rule.ruleType ? ` _(${rule.ruleType})_` : "";
  lines.push(
    `- **Rule:** ${rule.name}${type}${rule.description ? ` — ${rule.description}` : ""}`,
  );
}

function appendScenario(lines: string[], scenario: DesignedScenario): void {
  lines.push(`- **Scenario:** ${scenario.name} — ${scenario.description}`);
  lines.push(`  - Given: ${scenario.given}`);
  lines.push(`  - When: ${scenario.when}`);
  lines.push(`  - Then: ${scenario.then}`);
}

export type { DesignedActor };
