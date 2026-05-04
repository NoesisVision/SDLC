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
import { DesignDocImplementedError, DesignDocsService } from "./design-docs.service.js";
import type {
  BoundedContextMapEntry,
  ModelTarget,
} from "./design-docs.repository.js";
import type { IndexStateService } from "../../indexer/index-state.service.js";
import { gateWriteTool } from "../../indexer/write-gate.js";
import {
  runFileOutputTool,
  runInlineJsonTool,
} from "../../mcp-tool-output.js";

export function registerDesignDocsTools(
  mcp: McpServer,
  service: DesignDocsService,
  indexState: IndexStateService,
): void {
  registerPrepareDesignDocPath(mcp, service);
  registerSaveDesignDoc(mcp, service, indexState);
  registerReadDesignDoc(mcp, service);
  registerListDesignDocs(mcp, service);
  registerDeleteDesignDoc(mcp, service, indexState);
  registerReadBoundedContextMap(mcp, service);
  registerReadModelForModules(mcp, service);
  registerMarkDesignDocImplemented(mcp, service, indexState);
  registerListActors(mcp, service);
  registerUpsertActor(mcp, service, indexState);
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
        "Filename is `<slug-up-to-20>-<id-suffix>.json` under `<projectDir>/noesis/design-docs/` " +
        "(id-suffix is the last 8 hex chars of the dash-stripped UUID, extended on collision). " +
        "Call BEFORE writing the JSON file: put the returned `id` into the JSON's `id` field and write to `canonical_path`. " +
        "When iterating an existing doc, pass its known `id` (the slug may change for renames). " +
        "Returns `{ status: \"Ok\", id, canonical_path }` for active docs, or " +
        "`{ status: \"AlreadyImplemented\", design_doc_id, name }` when the supplied `id` belongs to a doc that has already been " +
        "marked implemented (the agent must ask the user whether to start a new doc or stop, and never proceed to write JSON).",
      inputSchema: {
        name: z
          .string()
          .describe("The DesignDoc's `name` field (drives the filename slug)."),
        id: z
          .string()
          .optional()
          .describe(
            "Existing DesignDoc id (omit for a new doc — a UUIDv7 will be minted).",
          ),
      },
    },
    async ({ name, id }) =>
      runInlineJsonTool(() => service.prepareDesignDocPath(name, id ?? null)),
  );
}

function registerSaveDesignDoc(
  mcp: McpServer,
  service: DesignDocsService,
  indexState: IndexStateService,
): void {
  mcp.registerTool(
    "save_design_doc",
    {
      description:
        "Persist a DesignDoc into the knowledge graph from a JSON file matching DesignDocSchema. " +
        "Path MUST be the canonical path returned by `prepare_design_doc_path` for the doc's id+name. " +
        "Tool reads it, validates, and applies ChangeSets recursively (added → upsert, " +
        "modified → partial update, removed → delete by name). " +
        "Quality gate (rejects on save): every `added` Rule needs description ≥80 chars (Trigger / Pre / Algorithm / Post / Edge cases — no tautologies); " +
        "every `added` Quality Attribute needs description ≥80 chars stating a measurable target/threshold/scope; " +
        "every `added` Behaviour needs description ≥400 chars (Input / Validation / numbered Steps / Output); " +
        "behaviours with `actor` set must be hosted by an `application_service` BuildingBlock; " +
        "every behaviour `actor` must reference a name present in the actor catalog (call `upsert_actor` first to register a new actor — `list_actors` shows the catalog). " +
        "Warnings (non-blocking): a Bounded Context with >20 building blocks and 0 modules; an application_service or ≥3-block-using behaviour without an embedded ```mermaid sequence diagram. " +
        "User-edit gate (fires only when this save renames the doc — different slug than the prior canonical filename): any element in the prior on-disk state with `edited_by_user: true` rejects the save when targeted by `modified` or `removed` unless its element-path appears in `confirmed_edits`. " +
        "Implemented-doc gate: when the targeted doc has already been marked implemented (via `mark_design_doc_implemented`), the tool returns `{ status: \"AlreadyImplemented\", design_doc_id, name }` instead of saving — the agent must stop and ask the user whether to create a new doc. " +
        "Returns { status: \"Ok\", design_doc_id, warnings: string[] } on success; " +
        "validation, conflict, or storage failures surface as a tool error.",
      inputSchema: {
        path: z
          .string()
          .describe(
            "Absolute canonical path returned by `prepare_design_doc_path`.",
          ),
        confirmed_edits: z
          .array(z.string())
          .optional()
          .describe(
            "Element paths the user has explicitly approved overwriting. " +
              "Format: 'boundedContexts/<bc>/buildingBlocks/<bb>/behaviours/<bh>' (or '/rules/<r>', '/scenarios/<s>', '/qualityAttributes/<qa>'). " +
              "Required for any user-edited element targeted by `modified` or `removed`. Agent must NEVER include a path here without explicit user confirmation.",
          ),
      },
    },
    async ({ path, confirmed_edits }) =>
      runInlineJsonTool(() =>
        gateWriteTool(indexState, async () => {
          try {
            return await service.saveDesignDocFromFile(path, confirmed_edits ?? []);
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
      ),
  );
}

function registerMarkDesignDocImplemented(
  mcp: McpServer,
  service: DesignDocsService,
  indexState: IndexStateService,
): void {
  mcp.registerTool(
    "mark_design_doc_implemented",
    {
      description:
        "Seal a DesignDoc as implemented. Call this only after `implement-design-doc` has produced code that matches the doc " +
        "(the verification step `compare_implementation_to_design` returned `Ok`). " +
        "Sets `implemented: true` on the canonical JSON and the graph node. " +
        "From this point `save_design_doc`, `prepare_design_doc_path` (with this id), and the UI editor refuse to mutate the doc — " +
        "agents must create a new design doc to capture further changes. " +
        "Idempotent: a no-op when the doc is already implemented.",
      inputSchema: {
        design_doc_id: z
          .string()
          .describe("Id of the DesignDoc to mark as implemented."),
      },
    },
    async ({ design_doc_id }) =>
      runInlineJsonTool(() =>
        gateWriteTool(indexState, () =>
          service.markDesignDocImplemented(design_doc_id),
        ),
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
        "(bounded contexts → modules → building blocks → behaviours / rules / scenarios / quality attributes — quality attributes are nested at the level they apply) " +
        "to a tmp file and returns the file path. Read it with the Read tool. " +
        "Actors are not part of a single design doc — call `list_actors` to read the graph-global actor catalog.",
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
        "List all DesignDocs in the knowledge graph (id, name, description, bounded-context counts). " +
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
  indexState: IndexStateService,
): void {
  mcp.registerTool(
    "delete_design_doc",
    {
      description:
        "Remove a DesignDoc and all its descendants (bounded contexts, modules, " +
        "building blocks, behaviours, rules, scenarios, quality attributes) from the graph. " +
        "Graph-global actors are not deleted — manage them with `upsert_actor` / `list_actors`.",
      inputSchema: {
        design_doc_id: z.string().describe("Id of the DesignDoc to delete."),
      },
    },
    async ({ design_doc_id }) =>
      runInlineJsonTool(() =>
        gateWriteTool(indexState, () => service.deleteDesignDoc(design_doc_id)),
      ),
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
        "Render the existing model (Bounded Context → Module → Building Block → Behaviour, with rules, scenarios and quality attributes) " +
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

function registerListActors(
  mcp: McpServer,
  service: DesignDocsService,
): void {
  mcp.registerTool(
    "list_actors",
    {
      description:
        "Return the graph-global actor catalog (every actor referenced by any design doc). " +
        "Use this before authoring a design doc to reuse an existing actor name whenever the persona matches; " +
        "introduce a new actor with `upsert_actor` only when no existing one fits. " +
        "Result is returned inline (small payload) — no tmp file.",
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
  indexState: IndexStateService,
): void {
  mcp.registerTool(
    "upsert_actor",
    {
      description:
        "Create or update a graph-global actor. Call this BEFORE `save_design_doc` for every new actor name a behaviour will reference, " +
        "otherwise the save fails (every `behaviour.actor` must resolve to a name in the catalog). " +
        "Updating an existing actor refreshes its description; reusing an existing name in a behaviour does not require a call here. " +
        "Returns `{ status: \"Ok\", name }`.",
      inputSchema: {
        name: z.string().describe("Actor name (graph-global identity)."),
        description: z
          .string()
          .nullable()
          .optional()
          .describe(
            "One-line description of the actor's role/persona — surfaces in the catalog and in design-doc renderings.",
          ),
      },
    },
    async ({ name, description }) =>
      runInlineJsonTool(() =>
        gateWriteTool(indexState, () =>
          service.upsertActor({
            name,
            description: description ?? null,
          }),
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
    appendQualityAttributes(parts, bc.qualityAttributes?.added ?? []);
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
  lines.push(`- **Implemented:** ${doc.implemented === true ? "yes" : "no"}`);
  lines.push("");
  appendBoundedContexts(lines, doc.boundedContexts?.added ?? []);
  return lines.join("\n").trimEnd();
}

function editedSuffix(item: { edited_by_user?: boolean }): string {
  return item.edited_by_user === true ? " _[edited_by_user]_" : "";
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
    lines.push(`- **${q.name}**${type}${editedSuffix(q)} — ${q.description ?? ""}`);
  }
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
    lines.push(`### ${bc.name}${editedSuffix(bc)}`);
    if (bc.description) lines.push(bc.description);
    appendQualityAttributes(lines, bc.qualityAttributes?.added ?? []);
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
  lines.push(`${"#".repeat(headingLevel)} Module: ${mod.name}${editedSuffix(mod)}`);
  if (mod.description) lines.push(mod.description);
  appendQualityAttributes(lines, mod.qualityAttributes?.added ?? []);
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
  lines.push(`${"#".repeat(headingLevel)} ${bb.name}${type}${editedSuffix(bb)}`);
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
  lines.push(
    `${"#".repeat(headingLevel)} ${bh.name}${tag}${visibility}${editedSuffix(bh)}`,
  );
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

function appendRule(lines: string[], rule: DesignedRule): void {
  const type = rule.ruleType ? ` _(${rule.ruleType})_` : "";
  lines.push(
    `- **Rule:** ${rule.name}${type}${editedSuffix(rule)}${rule.description ? ` — ${rule.description}` : ""}`,
  );
}

function appendScenario(lines: string[], scenario: DesignedScenario): void {
  lines.push(
    `- **Scenario:** ${scenario.name}${editedSuffix(scenario)} — ${scenario.description}`,
  );
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
    parts.push(`- **Implemented:** ${d.implemented === true ? "yes" : "no"}`);
    parts.push(`- **Bounded contexts:** ${d.bounded_context_count}`);
    parts.push("");
  }
  return parts.join("\n").trimEnd();
}

// DesignedActor isn't formatted here — `list_actors` returns the raw list inline,
// the agent surfaces it directly. Keep the import for typing only when needed.
export type { DesignedActor };
