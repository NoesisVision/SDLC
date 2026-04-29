import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { DatabaseService } from "../../database/database.service.js";
import type {
  DesignDoc,
  DesignDocOverview,
  DesignedActor,
  DesignedBehaviour,
  DesignedBoundedContext,
  DesignedBuildingBlock,
  DesignedDomainModule,
  DesignedProperty,
  DesignedQualityAttribute,
  DesignedRule,
  DesignedScenario,
} from "../../../../shared-contracts/design-doc.js";
import {
  actorNodeId,
  behaviourNodeId,
  boundedContextNodeId,
  buildingBlockNodeId,
  moduleNodeId,
  qualityAttributeNodeId,
  ruleNodeId,
  scenarioNodeId,
} from "./node-ids.js";

const SCHEMA_STATEMENTS = [
  "CREATE NODE TABLE IF NOT EXISTS DesignDoc(id STRING, name STRING, description STRING, source_json STRING, date STRING, source_sha STRING, edited_by_user BOOLEAN, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DesignedActor(id STRING, name STRING, description STRING, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DesignedBoundedContext(id STRING, name STRING, description STRING, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DesignedDomainModule(id STRING, name STRING, full_path STRING, description STRING, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DesignedBuildingBlock(id STRING, name STRING, type STRING, description STRING, properties STRING, implements STRING, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DesignedBehaviour(id STRING, name STRING, type STRING, description STRING, is_public BOOLEAN, input STRING[], output STRING[], used_building_blocks STRING[], actor_name STRING, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DesignedRule(id STRING, name STRING, rule_type STRING, description STRING, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DesignedScenario(id STRING, name STRING, description STRING, given STRING, when_clause STRING, then_clause STRING, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DesignedQualityAttribute(id STRING, name STRING, type STRING, description STRING, PRIMARY KEY(id))",
  "CREATE REL TABLE IF NOT EXISTS DD_HAS_ACTOR(FROM DesignDoc TO DesignedActor)",
  "CREATE REL TABLE IF NOT EXISTS DD_HAS_BC(FROM DesignDoc TO DesignedBoundedContext)",
  "CREATE REL TABLE IF NOT EXISTS DD_HAS_QA(FROM DesignDoc TO DesignedQualityAttribute)",
  "CREATE REL TABLE IF NOT EXISTS DBC_HAS_MODULE(FROM DesignedBoundedContext TO DesignedDomainModule)",
  "CREATE REL TABLE IF NOT EXISTS DBC_HAS_BB(FROM DesignedBoundedContext TO DesignedBuildingBlock)",
  "CREATE REL TABLE IF NOT EXISTS DM_HAS_MODULE(FROM DesignedDomainModule TO DesignedDomainModule)",
  "CREATE REL TABLE IF NOT EXISTS DM_HAS_BB(FROM DesignedDomainModule TO DesignedBuildingBlock)",
  "CREATE REL TABLE IF NOT EXISTS DBB_HAS_BEHAVIOUR(FROM DesignedBuildingBlock TO DesignedBehaviour)",
  "CREATE REL TABLE IF NOT EXISTS DBB_HAS_RULE(FROM DesignedBuildingBlock TO DesignedRule)",
  "CREATE REL TABLE IF NOT EXISTS DBB_HAS_SCENARIO(FROM DesignedBuildingBlock TO DesignedScenario)",
  "CREATE REL TABLE IF NOT EXISTS DBH_HAS_RULE(FROM DesignedBehaviour TO DesignedRule)",
  "CREATE REL TABLE IF NOT EXISTS DBH_HAS_SCENARIO(FROM DesignedBehaviour TO DesignedScenario)",
  "CREATE REL TABLE IF NOT EXISTS DBH_TRIGGERED_BY(FROM DesignedBehaviour TO DesignedActor)",
];

// Row schemas describe the literal column shape as returned by Cypher queries.
// They are intentionally separate from the domain contracts, which use nested
// ChangeSets; mapping between the two happens in rowTo* / applyStringChangeSet
// / (de)serializeProperties below.
//
// Kuzu/lbug quirk: an empty STRING[] is read back as `null` even when written as
// `[]`. Every STRING[] column therefore goes through `StringArrayRow`, which
// coalesces `null` to `[]` on read. Writes always send `[]` (never `null`).
const StringArrayRow = z
  .array(z.string())
  .nullable()
  .transform((v) => v ?? []);

const DesignDocRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  source_json: z.string(),
  date: z.string(),
  edited_by_user: z.boolean().nullable().optional(),
});
type DesignDocRow = z.infer<typeof DesignDocRowSchema>;

const ActorRowSchema = z.object({
  name: z.string(),
  description: z.string(),
});
type ActorRow = z.infer<typeof ActorRowSchema>;

const QualityAttributeRowSchema = z.object({
  name: z.string(),
  type: z.string(),
  description: z.string(),
});
type QualityAttributeRow = z.infer<typeof QualityAttributeRowSchema>;

const BoundedContextRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
});
type BoundedContextRow = z.infer<typeof BoundedContextRowSchema>;

const DomainModuleRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
});
type DomainModuleRow = z.infer<typeof DomainModuleRowSchema>;

const BuildingBlockRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  description: z.string(),
  properties: z.string(),
  implements: z.string(),
});
type BuildingBlockRow = z.infer<typeof BuildingBlockRowSchema>;

const BehaviourRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  description: z.string(),
  is_public: z.boolean(),
  input: StringArrayRow,
  output: StringArrayRow,
  used: StringArrayRow,
  actor_name: z.string(),
});
type BehaviourRow = z.infer<typeof BehaviourRowSchema>;

const RuleRowSchema = z.object({
  name: z.string(),
  rule_type: z.string(),
  description: z.string(),
});
type RuleRow = z.infer<typeof RuleRowSchema>;

const ScenarioRowSchema = z.object({
  name: z.string(),
  description: z.string(),
  given: z.string(),
  when_clause: z.string(),
  then_clause: z.string(),
});
type ScenarioRow = z.infer<typeof ScenarioRowSchema>;

const IdRowSchema = z.object({ id: z.string() });
type IdRow = z.infer<typeof IdRowSchema>;

const CountRowSchema = z.object({ c: z.union([z.number(), z.bigint()]) });
type CountRow = z.infer<typeof CountRowSchema>;

export interface BoundedContextMapModule {
  name: string;
  description: string | null;
}

export interface BoundedContextMapEntry {
  design_doc_id: string;
  design_doc_name: string;
  bounded_context_name: string;
  description: string | null;
  modules: BoundedContextMapModule[];
}

export interface ModelTarget {
  design_doc_id: string;
  bounded_context_name: string;
  module_name: string | null;
}

@Injectable()
export class DesignDocsRepository {
  private readonly logger = new Logger(DesignDocsRepository.name);

  constructor(private readonly db: DatabaseService) {}

  async initSchema(): Promise<void> {
    for (const stmt of SCHEMA_STATEMENTS) {
      await this.db.query(stmt);
    }
    this.logger.log("DesignDoc schema initialized");
  }

  async applyDesignDoc(doc: DesignDoc, date: string): Promise<void> {
    await this.upsertDesignDocNode(doc, date);

    if (doc.actors !== undefined) {
      await this.applyActorChangeSet(doc.id, doc.actors);
    }
    if (doc.qualityAttributes !== undefined) {
      await this.applyQualityAttributeChangeSet(doc.id, doc.qualityAttributes);
    }
    if (doc.boundedContexts !== undefined) {
      await this.applyBoundedContextChangeSet(doc.id, doc.boundedContexts);
    }
  }

  async readDesignDocSource(designDocId: string): Promise<DesignDoc | null> {
    const row = await this.fetchDesignDocRow(designDocId);
    if (row === null) return null;
    if (row.source_json === "") return null;
    const parsed = JSON.parse(row.source_json);
    return parsed as DesignDoc;
  }

  async listDesignDocs(): Promise<DesignDocOverview[]> {
    const rawRows = await this.db.query<DesignDocRow>(
      "MATCH (d:DesignDoc) RETURN d.id AS id, d.name AS name, d.description AS description, d.source_json AS source_json, d.date AS date, d.edited_by_user AS edited_by_user ORDER BY d.name",
    );
    const rows = z.array(DesignDocRowSchema).parse(rawRows);
    const out: DesignDocOverview[] = [];
    for (const row of rows) {
      out.push({
        id: row.id,
        name: row.name,
        description: row.description,
        date: row.date,
        edited_by_user: row.edited_by_user ?? false,
        actor_count: await this.countChildren(row.id, "DD_HAS_ACTOR", "DesignedActor"),
        bounded_context_count: await this.countChildren(
          row.id,
          "DD_HAS_BC",
          "DesignedBoundedContext",
        ),
        quality_attribute_count: await this.countChildren(
          row.id,
          "DD_HAS_QA",
          "DesignedQualityAttribute",
        ),
      });
    }
    return out;
  }

  private async countChildren(
    designDocId: string,
    relName: string,
    childLabel: string,
  ): Promise<number> {
    const rows = await this.db.query<CountRow>(
      `MATCH (d:DesignDoc)-[:${relName}]->(c:${childLabel}) WHERE d.id = $id RETURN COUNT(c) AS c`,
      { id: designDocId },
    );
    return rows.length === 0 ? 0 : Number(rows[0].c);
  }

  async readBoundedContextMap(): Promise<BoundedContextMapEntry[]> {
    const RowSchema = z.object({
      design_doc_id: z.string(),
      design_doc_name: z.string(),
      bc_id: z.string(),
      bc_name: z.string(),
      bc_description: z.string(),
    });
    const ModuleRowSchema = z.object({
      name: z.string(),
      description: z.string(),
    });
    const rawRows = await this.db.query<unknown>(
      "MATCH (d:DesignDoc)-[:DD_HAS_BC]->(b:DesignedBoundedContext) " +
        "RETURN d.id AS design_doc_id, d.name AS design_doc_name, " +
        "b.id AS bc_id, b.name AS bc_name, b.description AS bc_description " +
        "ORDER BY d.name, b.name",
    );
    const rows = z.array(RowSchema).parse(rawRows);
    const out: BoundedContextMapEntry[] = [];
    for (const row of rows) {
      const rawModules = await this.db.query<unknown>(
        "MATCH (b:DesignedBoundedContext)-[:DBC_HAS_MODULE]->(m:DesignedDomainModule) WHERE b.id = $id " +
          "RETURN m.name AS name, m.description AS description ORDER BY m.name",
        { id: row.bc_id },
      );
      const modules = z.array(ModuleRowSchema).parse(rawModules).map((m) => ({
        name: m.name,
        description: emptyToNull(m.description),
      }));
      out.push({
        design_doc_id: row.design_doc_id,
        design_doc_name: row.design_doc_name,
        bounded_context_name: row.bc_name,
        description: emptyToNull(row.bc_description),
        modules,
      });
    }
    return out;
  }

  async readModelForTargets(
    targets: ModelTarget[],
  ): Promise<DesignedBoundedContext[]> {
    const out: DesignedBoundedContext[] = [];
    for (const target of targets) {
      const bc = await this.fetchBoundedContextByName(
        target.design_doc_id,
        target.bounded_context_name,
      );
      if (bc === null) continue;
      if (target.module_name === null) {
        out.push(bc);
        continue;
      }
      const filteredModules = (bc.modules?.added ?? []).filter(
        (m) => m.name === target.module_name,
      );
      out.push({
        ...bc,
        modules: { added: filteredModules, removed: [], modified: [] },
        buildingBlocks: { added: [], removed: [], modified: [] },
      });
    }
    return out;
  }

  async readDesignDoc(designDocId: string): Promise<DesignDoc | null> {
    const docRow = await this.fetchDesignDocRow(designDocId);
    if (docRow === null) return null;

    const actors = await this.fetchActors(designDocId);
    const qualityAttributes = await this.fetchQualityAttributes(designDocId);
    const boundedContexts = await this.fetchBoundedContexts(designDocId);

    return {
      id: docRow.id,
      name: docRow.name,
      description: docRow.description,
      actors: { added: actors, removed: [], modified: [] },
      boundedContexts: { added: boundedContexts, removed: [], modified: [] },
      qualityAttributes: {
        added: qualityAttributes,
        removed: [],
        modified: [],
      },
    };
  }

  async deleteDesignDoc(designDocId: string): Promise<void> {
    const labels = [
      "DesignedScenario",
      "DesignedRule",
      "DesignedBehaviour",
      "DesignedBuildingBlock",
      "DesignedDomainModule",
      "DesignedBoundedContext",
      "DesignedActor",
      "DesignedQualityAttribute",
    ];
    for (const label of labels) {
      await this.db.query(
        `MATCH (n:${label}) WHERE n.id STARTS WITH $prefix DETACH DELETE n`,
        { prefix: `${designDocId}|` },
      );
    }
    await this.db.query(
      "MATCH (d:DesignDoc) WHERE d.id = $id DETACH DELETE d",
      { id: designDocId },
    );
  }

  private async applyActorChangeSet(
    designDocId: string,
    changeSet: { added: DesignedActor[]; modified: DesignedActor[]; removed: string[] },
  ): Promise<void> {
    for (const name of changeSet.removed) {
      await this.deleteActor(designDocId, name);
    }
    for (const actor of changeSet.added) {
      await this.upsertActor(designDocId, actor, false);
    }
    for (const actor of changeSet.modified) {
      await this.upsertActor(designDocId, actor, true);
    }
  }

  private async applyQualityAttributeChangeSet(
    designDocId: string,
    changeSet: {
      added: DesignedQualityAttribute[];
      modified: DesignedQualityAttribute[];
      removed: string[];
    },
  ): Promise<void> {
    for (const name of changeSet.removed) {
      await this.deleteQualityAttribute(designDocId, name);
    }
    for (const qa of changeSet.added) {
      await this.upsertQualityAttribute(designDocId, qa, false);
    }
    for (const qa of changeSet.modified) {
      await this.upsertQualityAttribute(designDocId, qa, true);
    }
  }

  private async applyBoundedContextChangeSet(
    designDocId: string,
    changeSet: {
      added: DesignedBoundedContext[];
      modified: DesignedBoundedContext[];
      removed: string[];
    },
  ): Promise<void> {
    for (const name of changeSet.removed) {
      await this.deleteBoundedContext(designDocId, name);
    }
    for (const bc of changeSet.added) {
      await this.upsertBoundedContext(designDocId, bc, false);
    }
    for (const bc of changeSet.modified) {
      await this.upsertBoundedContext(designDocId, bc, true);
    }
  }

  private async upsertDesignDocNode(
    doc: DesignDoc,
    date: string,
  ): Promise<void> {
    const sourceJson = JSON.stringify(doc);
    if (await this.nodeExists("DesignDoc", doc.id)) {
      await this.updateNodeFields("DesignDoc", doc.id, {
        name: doc.name,
        description: doc.description,
        source_json: sourceJson,
        date,
      });
      return;
    }
    await this.db.query(
      "CREATE (d:DesignDoc {id: $id, name: $name, description: $description, source_json: $source_json, date: $date})",
      {
        id: doc.id,
        name: doc.name,
        description: doc.description,
        source_json: sourceJson,
        date,
      },
    );
  }

  private async upsertActor(
    designDocId: string,
    actor: DesignedActor,
    isModification: boolean,
  ): Promise<void> {
    const id = actorNodeId(designDocId, actor.name);
    if (await this.nodeExists("DesignedActor", id)) {
      const fields = isModification
        ? buildPartialFields({
            description: actor.description,
          })
        : { name: actor.name, description: actor.description ?? "" };
      await this.updateNodeFields("DesignedActor", id, fields);
      return;
    }
    await this.db.query(
      "CREATE (a:DesignedActor {id: $id, name: $name, description: $description})",
      { id, name: actor.name, description: actor.description ?? "" },
    );
    await this.linkParentToChild(
      "DesignDoc",
      designDocId,
      "DesignedActor",
      id,
      "DD_HAS_ACTOR",
    );
  }

  private async upsertQualityAttribute(
    designDocId: string,
    qa: DesignedQualityAttribute,
    isModification: boolean,
  ): Promise<void> {
    const id = qualityAttributeNodeId(designDocId, qa.name);
    if (await this.nodeExists("DesignedQualityAttribute", id)) {
      const fields = isModification
        ? buildPartialFields({
            type: qa.type,
            description: qa.description,
          })
        : {
            name: qa.name,
            type: qa.type ?? "",
            description: qa.description ?? "",
          };
      await this.updateNodeFields("DesignedQualityAttribute", id, fields);
      return;
    }
    await this.db.query(
      "CREATE (q:DesignedQualityAttribute {id: $id, name: $name, type: $type, description: $description})",
      {
        id,
        name: qa.name,
        type: qa.type ?? "",
        description: qa.description ?? "",
      },
    );
    await this.linkParentToChild(
      "DesignDoc",
      designDocId,
      "DesignedQualityAttribute",
      id,
      "DD_HAS_QA",
    );
  }

  private async upsertBoundedContext(
    designDocId: string,
    bc: DesignedBoundedContext,
    isModification: boolean,
  ): Promise<void> {
    const id = boundedContextNodeId(designDocId, bc.name);
    if (!(await this.nodeExists("DesignedBoundedContext", id))) {
      await this.db.query(
        "CREATE (b:DesignedBoundedContext {id: $id, name: $name, description: $description})",
        { id, name: bc.name, description: bc.description ?? "" },
      );
      await this.linkParentToChild(
        "DesignDoc",
        designDocId,
        "DesignedBoundedContext",
        id,
        "DD_HAS_BC",
      );
    } else {
      const fields = isModification
        ? buildPartialFields({ description: bc.description })
        : { name: bc.name, description: bc.description ?? "" };
      await this.updateNodeFields("DesignedBoundedContext", id, fields);
    }

    if (bc.modules !== undefined) {
      for (const moduleName of bc.modules.removed) {
        await this.deleteModule(id, moduleName);
      }
      for (const mod of bc.modules.added) {
        await this.upsertModule(id, mod, bc.name, false);
      }
      for (const mod of bc.modules.modified) {
        await this.upsertModule(id, mod, bc.name, true);
      }
    }

    if (bc.buildingBlocks !== undefined) {
      for (const bbName of bc.buildingBlocks.removed) {
        await this.deleteBuildingBlock(id, bbName);
      }
      for (const bb of bc.buildingBlocks.added) {
        await this.upsertBuildingBlock(id, "DesignedBoundedContext", bb, false);
      }
      for (const bb of bc.buildingBlocks.modified) {
        await this.upsertBuildingBlock(id, "DesignedBoundedContext", bb, true);
      }
    }
  }

  private async upsertModule(
    bcId: string,
    mod: DesignedDomainModule,
    bcName: string,
    isModification: boolean,
  ): Promise<void> {
    const fullPath = `${bcName}.${mod.name}`;
    const id = moduleNodeId(bcId, fullPath);
    if (!(await this.nodeExists("DesignedDomainModule", id))) {
      await this.db.query(
        "CREATE (m:DesignedDomainModule {id: $id, name: $name, full_path: $full_path, description: $description})",
        {
          id,
          name: mod.name,
          full_path: fullPath,
          description: mod.description ?? "",
        },
      );
      await this.linkParentToChild(
        "DesignedBoundedContext",
        bcId,
        "DesignedDomainModule",
        id,
        "DBC_HAS_MODULE",
      );
    } else {
      const fields = isModification
        ? buildPartialFields({ description: mod.description })
        : {
            name: mod.name,
            full_path: fullPath,
            description: mod.description ?? "",
          };
      await this.updateNodeFields("DesignedDomainModule", id, fields);
    }

    if (mod.buildingBlocks !== undefined) {
      for (const bbName of mod.buildingBlocks.removed) {
        await this.deleteBuildingBlock(id, bbName);
      }
      for (const bb of mod.buildingBlocks.added) {
        await this.upsertBuildingBlock(id, "DesignedDomainModule", bb, false);
      }
      for (const bb of mod.buildingBlocks.modified) {
        await this.upsertBuildingBlock(id, "DesignedDomainModule", bb, true);
      }
    }
  }

  private async upsertBuildingBlock(
    containerId: string,
    containerLabel: "DesignedBoundedContext" | "DesignedDomainModule",
    bb: DesignedBuildingBlock,
    isModification: boolean,
  ): Promise<void> {
    const id = buildingBlockNodeId(containerId, bb.name);
    const propertiesJson = serializeProperties(bb.properties);
    const implementsJson = JSON.stringify(bb.implements ?? []);
    if (!(await this.nodeExists("DesignedBuildingBlock", id))) {
      await this.db.query(
        "CREATE (b:DesignedBuildingBlock {id: $id, name: $name, type: $type, description: $description, properties: $properties, implements: $implements})",
        {
          id,
          name: bb.name,
          type: bb.type ?? "",
          description: bb.description ?? "",
          properties: propertiesJson,
          implements: implementsJson,
        },
      );
      const relName =
        containerLabel === "DesignedBoundedContext"
          ? "DBC_HAS_BB"
          : "DM_HAS_BB";
      await this.linkParentToChild(
        containerLabel,
        containerId,
        "DesignedBuildingBlock",
        id,
        relName,
      );
    } else {
      const partialBase = buildPartialFields({
        type: bb.type,
        description: bb.description,
        properties: bb.properties === undefined ? undefined : propertiesJson,
      });
      const fields = isModification
        ? { ...partialBase, implements: implementsJson }
        : {
            name: bb.name,
            type: bb.type ?? "",
            description: bb.description ?? "",
            properties: propertiesJson,
            implements: implementsJson,
          };
      await this.updateNodeFields("DesignedBuildingBlock", id, fields);
    }

    if (bb.behaviours !== undefined) {
      for (const bhName of bb.behaviours.removed) {
        await this.deleteBehaviour(id, bhName);
      }
      for (const bh of bb.behaviours.added) {
        await this.upsertBehaviour(id, bh, false);
      }
      for (const bh of bb.behaviours.modified) {
        await this.upsertBehaviour(id, bh, true);
      }
    }

    if (bb.rules !== undefined) {
      for (const rName of bb.rules.removed) {
        await this.deleteRule(id, rName);
      }
      for (const r of bb.rules.added) {
        await this.upsertRule(id, "DesignedBuildingBlock", r, false);
      }
      for (const r of bb.rules.modified) {
        await this.upsertRule(id, "DesignedBuildingBlock", r, true);
      }
    }

    if (bb.scenarios !== undefined) {
      for (const sName of bb.scenarios.removed) {
        await this.deleteScenario(id, sName);
      }
      for (const s of bb.scenarios.added) {
        await this.upsertScenario(id, "DesignedBuildingBlock", s, false);
      }
      for (const s of bb.scenarios.modified) {
        await this.upsertScenario(id, "DesignedBuildingBlock", s, true);
      }
    }
  }

  private async upsertBehaviour(
    bbId: string,
    bh: DesignedBehaviour,
    isModification: boolean,
  ): Promise<void> {
    const id = behaviourNodeId(bbId, bh.name);
    const input = applyStringChangeSet(bh.input);
    const output = applyStringChangeSet(bh.output);
    const used = applyStringChangeSet(bh.usedBuildingBlocks);
    if (!(await this.nodeExists("DesignedBehaviour", id))) {
      await this.db.query(
        "CREATE (h:DesignedBehaviour {id: $id, name: $name, type: $type, description: $description, is_public: $is_public, input: $input, output: $output, used_building_blocks: $used, actor_name: $actor_name})",
        {
          id,
          name: bh.name,
          type: bh.type ?? "",
          description: bh.description ?? "",
          is_public: bh.isPublic,
          input,
          output,
          used,
          actor_name: bh.actor ?? "",
        },
      );
      await this.linkParentToChild(
        "DesignedBuildingBlock",
        bbId,
        "DesignedBehaviour",
        id,
        "DBB_HAS_BEHAVIOUR",
      );
    } else {
      const fields = isModification
        ? buildPartialFields({
            type: bh.type,
            description: bh.description,
            is_public: bh.isPublic,
            input: bh.input === undefined ? undefined : input,
            output: bh.output === undefined ? undefined : output,
            used_building_blocks:
              bh.usedBuildingBlocks === undefined ? undefined : used,
            actor_name: bh.actor,
          })
        : {
            name: bh.name,
            type: bh.type ?? "",
            description: bh.description ?? "",
            is_public: bh.isPublic,
            input,
            output,
            used_building_blocks: used,
            actor_name: bh.actor ?? "",
          };
      await this.updateNodeFields("DesignedBehaviour", id, fields);
    }

    if (bh.actor !== null && bh.actor !== "") {
      await this.linkBehaviourToActor(id, bh.actor);
    }

    if (bh.rules !== undefined) {
      for (const rName of bh.rules.removed) {
        await this.deleteRule(id, rName);
      }
      for (const r of bh.rules.added) {
        await this.upsertRule(id, "DesignedBehaviour", r, false);
      }
      for (const r of bh.rules.modified) {
        await this.upsertRule(id, "DesignedBehaviour", r, true);
      }
    }

    if (bh.scenarios !== undefined) {
      for (const sName of bh.scenarios.removed) {
        await this.deleteScenario(id, sName);
      }
      for (const s of bh.scenarios.added) {
        await this.upsertScenario(id, "DesignedBehaviour", s, false);
      }
      for (const s of bh.scenarios.modified) {
        await this.upsertScenario(id, "DesignedBehaviour", s, true);
      }
    }
  }

  private async upsertRule(
    parentId: string,
    parentLabel: "DesignedBuildingBlock" | "DesignedBehaviour",
    rule: DesignedRule,
    isModification: boolean,
  ): Promise<void> {
    const id = ruleNodeId(parentId, rule.name);
    if (!(await this.nodeExists("DesignedRule", id))) {
      await this.db.query(
        "CREATE (r:DesignedRule {id: $id, name: $name, rule_type: $rule_type, description: $description})",
        {
          id,
          name: rule.name,
          rule_type: rule.ruleType ?? "",
          description: rule.description ?? "",
        },
      );
      const relName =
        parentLabel === "DesignedBuildingBlock"
          ? "DBB_HAS_RULE"
          : "DBH_HAS_RULE";
      await this.linkParentToChild(
        parentLabel,
        parentId,
        "DesignedRule",
        id,
        relName,
      );
    } else {
      const fields = isModification
        ? buildPartialFields({
            rule_type: rule.ruleType,
            description: rule.description,
          })
        : {
            name: rule.name,
            rule_type: rule.ruleType ?? "",
            description: rule.description ?? "",
          };
      await this.updateNodeFields("DesignedRule", id, fields);
    }
  }

  private async upsertScenario(
    parentId: string,
    parentLabel: "DesignedBuildingBlock" | "DesignedBehaviour",
    scenario: DesignedScenario,
    isModification: boolean,
  ): Promise<void> {
    const id = scenarioNodeId(parentId, scenario.name);
    if (!(await this.nodeExists("DesignedScenario", id))) {
      await this.db.query(
        "CREATE (s:DesignedScenario {id: $id, name: $name, description: $description, given: $given, when_clause: $when_clause, then_clause: $then_clause})",
        {
          id,
          name: scenario.name,
          description: scenario.description,
          given: scenario.given,
          when_clause: scenario.when,
          then_clause: scenario.then,
        },
      );
      const relName =
        parentLabel === "DesignedBuildingBlock"
          ? "DBB_HAS_SCENARIO"
          : "DBH_HAS_SCENARIO";
      await this.linkParentToChild(
        parentLabel,
        parentId,
        "DesignedScenario",
        id,
        relName,
      );
    } else {
      const fields = isModification
        ? buildPartialFields({
            description: scenario.description,
            given: scenario.given,
            when_clause: scenario.when,
            then_clause: scenario.then,
          })
        : {
            name: scenario.name,
            description: scenario.description,
            given: scenario.given,
            when_clause: scenario.when,
            then_clause: scenario.then,
          };
      await this.updateNodeFields("DesignedScenario", id, fields);
    }
  }

  private async linkBehaviourToActor(
    behaviourId: string,
    actorName: string,
  ): Promise<void> {
    const rows = await this.db.query<IdRow>(
      "MATCH (a:DesignedActor) WHERE a.name = $name RETURN a.id AS id LIMIT 1",
      { name: actorName },
    );
    if (rows.length === 0) return;
    const actorId = rows[0].id;
    if (
      await this.edgeExists(
        "DBH_TRIGGERED_BY",
        "DesignedBehaviour",
        behaviourId,
        "DesignedActor",
        actorId,
      )
    ) {
      return;
    }
    await this.db.query(
      "MATCH (h:DesignedBehaviour), (a:DesignedActor) WHERE h.id = $hId AND a.id = $aId CREATE (h)-[:DBH_TRIGGERED_BY]->(a)",
      { hId: behaviourId, aId: actorId },
    );
  }

  private async deleteActor(
    designDocId: string,
    actorName: string,
  ): Promise<void> {
    await this.deleteNodeById(
      "DesignedActor",
      actorNodeId(designDocId, actorName),
    );
  }

  private async deleteQualityAttribute(
    designDocId: string,
    qaName: string,
  ): Promise<void> {
    await this.deleteNodeById(
      "DesignedQualityAttribute",
      qualityAttributeNodeId(designDocId, qaName),
    );
  }

  private async deleteBoundedContext(
    designDocId: string,
    bcName: string,
  ): Promise<void> {
    const bcId = boundedContextNodeId(designDocId, bcName);
    await this.deleteSubtree("DesignedBoundedContext", bcId);
  }

  private async deleteModule(bcId: string, moduleName: string): Promise<void> {
    const rows = await this.db.query<IdRow>(
      "MATCH (b:DesignedBoundedContext)-[:DBC_HAS_MODULE]->(m:DesignedDomainModule) " +
        "WHERE b.id = $bcId AND m.name = $name RETURN m.id AS id LIMIT 1",
      { bcId, name: moduleName },
    );
    if (rows.length === 0) return;
    await this.deleteSubtree("DesignedDomainModule", rows[0].id);
  }

  private async deleteBuildingBlock(
    containerId: string,
    bbName: string,
  ): Promise<void> {
    const bbId = buildingBlockNodeId(containerId, bbName);
    await this.deleteSubtree("DesignedBuildingBlock", bbId);
  }

  private async deleteBehaviour(
    bbId: string,
    behaviourName: string,
  ): Promise<void> {
    const id = behaviourNodeId(bbId, behaviourName);
    await this.deleteSubtree("DesignedBehaviour", id);
  }

  private async deleteRule(parentId: string, ruleName: string): Promise<void> {
    await this.deleteNodeById("DesignedRule", ruleNodeId(parentId, ruleName));
  }

  private async deleteScenario(
    parentId: string,
    scenarioName: string,
  ): Promise<void> {
    await this.deleteNodeById(
      "DesignedScenario",
      scenarioNodeId(parentId, scenarioName),
    );
  }

  private async deleteSubtree(label: string, id: string): Promise<void> {
    await this.db.query(
      `MATCH (n:${label})-[*]->(child) WHERE n.id = $id DETACH DELETE child`,
      { id },
    );
    await this.deleteNodeById(label, id);
  }

  private async deleteNodeById(label: string, id: string): Promise<void> {
    await this.db.query(
      `MATCH (n:${label}) WHERE n.id = $id DETACH DELETE n`,
      { id },
    );
  }

  private async fetchDesignDocRow(
    designDocId: string,
  ): Promise<DesignDocRow | null> {
    const rawRows = await this.db.query<DesignDocRow>(
      "MATCH (d:DesignDoc) WHERE d.id = $id RETURN d.id AS id, d.name AS name, d.description AS description, d.source_json AS source_json, d.date AS date LIMIT 1",
      { id: designDocId },
    );
    if (rawRows.length === 0) return null;
    return DesignDocRowSchema.parse(rawRows[0]);
  }

  private async fetchActors(designDocId: string): Promise<DesignedActor[]> {
    const rawRows = await this.db.query<ActorRow>(
      "MATCH (d:DesignDoc)-[:DD_HAS_ACTOR]->(a:DesignedActor) WHERE d.id = $id " +
        "RETURN a.name AS name, a.description AS description ORDER BY a.name",
      { id: designDocId },
    );
    return z.array(ActorRowSchema).parse(rawRows).map(rowToActor);
  }

  private async fetchQualityAttributes(
    designDocId: string,
  ): Promise<DesignedQualityAttribute[]> {
    const rawRows = await this.db.query<QualityAttributeRow>(
      "MATCH (d:DesignDoc)-[:DD_HAS_QA]->(q:DesignedQualityAttribute) WHERE d.id = $id " +
        "RETURN q.name AS name, q.type AS type, q.description AS description ORDER BY q.name",
      { id: designDocId },
    );
    return z.array(QualityAttributeRowSchema).parse(rawRows).map(rowToQualityAttribute);
  }

  private async fetchBoundedContexts(
    designDocId: string,
  ): Promise<DesignedBoundedContext[]> {
    const rawRows = await this.db.query<BoundedContextRow>(
      "MATCH (d:DesignDoc)-[:DD_HAS_BC]->(b:DesignedBoundedContext) WHERE d.id = $id " +
        "RETURN b.id AS id, b.name AS name, b.description AS description ORDER BY b.name",
      { id: designDocId },
    );
    const rows = z.array(BoundedContextRowSchema).parse(rawRows);
    const out: DesignedBoundedContext[] = [];
    for (const r of rows) {
      const modules = await this.fetchModules(r.id);
      const buildingBlocks = await this.fetchBuildingBlocksOfContext(r.id);
      out.push({
        name: r.name,
        description: emptyToNull(r.description),
        modules: { added: modules, removed: [], modified: [] },
        buildingBlocks: { added: buildingBlocks, removed: [], modified: [] },
      });
    }
    return out;
  }

  private async fetchBoundedContextByName(
    designDocId: string,
    bcName: string,
  ): Promise<DesignedBoundedContext | null> {
    const rawRows = await this.db.query<BoundedContextRow>(
      "MATCH (d:DesignDoc)-[:DD_HAS_BC]->(b:DesignedBoundedContext) " +
        "WHERE d.id = $designDocId AND b.name = $bcName " +
        "RETURN b.id AS id, b.name AS name, b.description AS description LIMIT 1",
      { designDocId, bcName },
    );
    const rows = z.array(BoundedContextRowSchema).parse(rawRows);
    if (rows.length === 0) return null;
    const row = rows[0];
    const modules = await this.fetchModules(row.id);
    const buildingBlocks = await this.fetchBuildingBlocksOfContext(row.id);
    return {
      name: row.name,
      description: emptyToNull(row.description),
      modules: { added: modules, removed: [], modified: [] },
      buildingBlocks: { added: buildingBlocks, removed: [], modified: [] },
    };
  }

  private async fetchModules(
    bcId: string,
  ): Promise<DesignedDomainModule[]> {
    const rawRows = await this.db.query<DomainModuleRow>(
      "MATCH (b:DesignedBoundedContext)-[:DBC_HAS_MODULE]->(m:DesignedDomainModule) WHERE b.id = $id " +
        "RETURN m.id AS id, m.name AS name, m.description AS description ORDER BY m.name",
      { id: bcId },
    );
    const rows = z.array(DomainModuleRowSchema).parse(rawRows);
    const out: DesignedDomainModule[] = [];
    for (const r of rows) {
      const buildingBlocks = await this.fetchBuildingBlocksOfModule(r.id);
      out.push({
        name: r.name,
        description: emptyToNull(r.description),
        buildingBlocks: { added: buildingBlocks, removed: [], modified: [] },
      });
    }
    return out;
  }

  private async fetchBuildingBlocksOfContext(
    bcId: string,
  ): Promise<DesignedBuildingBlock[]> {
    return this.fetchBuildingBlocks(
      "MATCH (b:DesignedBoundedContext)-[:DBC_HAS_BB]->(bb:DesignedBuildingBlock) WHERE b.id = $id ",
      bcId,
    );
  }

  private async fetchBuildingBlocksOfModule(
    moduleId: string,
  ): Promise<DesignedBuildingBlock[]> {
    return this.fetchBuildingBlocks(
      "MATCH (m:DesignedDomainModule)-[:DM_HAS_BB]->(bb:DesignedBuildingBlock) WHERE m.id = $id ",
      moduleId,
    );
  }

  private async fetchBuildingBlocks(
    matchClause: string,
    parentId: string,
  ): Promise<DesignedBuildingBlock[]> {
    const rawRows = await this.db.query<BuildingBlockRow>(
      matchClause +
        "RETURN bb.id AS id, bb.name AS name, bb.type AS type, bb.description AS description, " +
        "bb.properties AS properties, bb.implements AS implements ORDER BY bb.name",
      { id: parentId },
    );
    const rows = z.array(BuildingBlockRowSchema).parse(rawRows);
    const out: DesignedBuildingBlock[] = [];
    for (const r of rows) {
      const behaviours = await this.fetchBehaviours(r.id);
      const rules = await this.fetchRulesOfBuildingBlock(r.id);
      const scenarios = await this.fetchScenariosOfBuildingBlock(r.id);
      out.push({
        name: r.name,
        type: emptyToNull(r.type) as DesignedBuildingBlock["type"],
        description: emptyToNull(r.description),
        implements: deserializeImplements(r.implements),
        properties: {
          added: deserializeProperties(r.properties),
          removed: [],
          modified: [],
        },
        behaviours: { added: behaviours, removed: [], modified: [] },
        rules: { added: rules, removed: [], modified: [] },
        scenarios: { added: scenarios, removed: [], modified: [] },
      });
    }
    return out;
  }

  private async fetchBehaviours(
    bbId: string,
  ): Promise<DesignedBehaviour[]> {
    const rawRows = await this.db.query<BehaviourRow>(
      "MATCH (b:DesignedBuildingBlock)-[:DBB_HAS_BEHAVIOUR]->(h:DesignedBehaviour) WHERE b.id = $id " +
        "RETURN h.id AS id, h.name AS name, h.type AS type, h.description AS description, h.is_public AS is_public, " +
        "h.input AS input, h.output AS output, h.used_building_blocks AS used, h.actor_name AS actor_name ORDER BY h.name",
      { id: bbId },
    );
    const rows = z.array(BehaviourRowSchema).parse(rawRows);
    const out: DesignedBehaviour[] = [];
    for (const r of rows) {
      const rules = await this.fetchRulesOfBehaviour(r.id);
      const scenarios = await this.fetchScenariosOfBehaviour(r.id);
      out.push({
        name: r.name,
        description: emptyToNull(r.description),
        type: emptyToNull(r.type) as DesignedBehaviour["type"],
        input: { added: r.input, removed: [], modified: [] },
        output: { added: r.output, removed: [], modified: [] },
        usedBuildingBlocks: { added: r.used, removed: [], modified: [] },
        rules: { added: rules, removed: [], modified: [] },
        scenarios: { added: scenarios, removed: [], modified: [] },
        isPublic: Boolean(r.is_public),
        actor: emptyToNull(r.actor_name),
      });
    }
    return out;
  }

  private async fetchRulesOfBuildingBlock(
    bbId: string,
  ): Promise<DesignedRule[]> {
    return this.fetchRules(
      "MATCH (b:DesignedBuildingBlock)-[:DBB_HAS_RULE]->(r:DesignedRule) WHERE b.id = $id ",
      bbId,
    );
  }

  private async fetchRulesOfBehaviour(
    bhId: string,
  ): Promise<DesignedRule[]> {
    return this.fetchRules(
      "MATCH (b:DesignedBehaviour)-[:DBH_HAS_RULE]->(r:DesignedRule) WHERE b.id = $id ",
      bhId,
    );
  }

  private async fetchRules(
    matchClause: string,
    parentId: string,
  ): Promise<DesignedRule[]> {
    const rawRows = await this.db.query<RuleRow>(
      matchClause +
        "RETURN r.name AS name, r.rule_type AS rule_type, r.description AS description ORDER BY r.name",
      { id: parentId },
    );
    return z.array(RuleRowSchema).parse(rawRows).map(rowToRule);
  }

  private async fetchScenariosOfBuildingBlock(
    bbId: string,
  ): Promise<DesignedScenario[]> {
    return this.fetchScenarios(
      "MATCH (b:DesignedBuildingBlock)-[:DBB_HAS_SCENARIO]->(s:DesignedScenario) WHERE b.id = $id ",
      bbId,
    );
  }

  private async fetchScenariosOfBehaviour(
    bhId: string,
  ): Promise<DesignedScenario[]> {
    return this.fetchScenarios(
      "MATCH (b:DesignedBehaviour)-[:DBH_HAS_SCENARIO]->(s:DesignedScenario) WHERE b.id = $id ",
      bhId,
    );
  }

  private async fetchScenarios(
    matchClause: string,
    parentId: string,
  ): Promise<DesignedScenario[]> {
    const rawRows = await this.db.query<ScenarioRow>(
      matchClause +
        "RETURN s.name AS name, s.description AS description, s.given AS given, s.when_clause AS when_clause, s.then_clause AS then_clause ORDER BY s.name",
      { id: parentId },
    );
    return z.array(ScenarioRowSchema).parse(rawRows).map(rowToScenario);
  }

  private async edgeExists(
    relName: string,
    fromLabel: string,
    fromId: string,
    toLabel: string,
    toId: string,
  ): Promise<boolean> {
    const rows = await this.db.query<IdRow>(
      `MATCH (a:${fromLabel})-[:${relName}]->(b:${toLabel}) WHERE a.id = $fromId AND b.id = $toId RETURN a.id AS id LIMIT 1`,
      { fromId, toId },
    );
    return rows.length > 0;
  }

  private async linkParentToChild(
    parentLabel: string,
    parentId: string,
    childLabel: string,
    childId: string,
    relName: string,
  ): Promise<void> {
    await this.db.query(
      `MATCH (p:${parentLabel}), (c:${childLabel}) WHERE p.id = $pId AND c.id = $cId CREATE (p)-[:${relName}]->(c)`,
      { pId: parentId, cId: childId },
    );
  }

  private async nodeExists(label: string, id: string): Promise<boolean> {
    const rows = await this.db.query<IdRow>(
      `MATCH (n:${label}) WHERE n.id = $id RETURN n.id AS id LIMIT 1`,
      { id },
    );
    return rows.length > 0;
  }

  private async updateNodeFields(
    label: string,
    id: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const setClause = keys.map((k) => `n.${k} = $${k}`).join(", ");
    await this.db.query(
      `MATCH (n:${label}) WHERE n.id = $id SET ${setClause}`,
      { id, ...fields },
    );
  }
}

function rowToActor(r: ActorRow): DesignedActor {
  return {
    name: r.name,
    description: emptyToNull(r.description),
  };
}

function rowToQualityAttribute(r: QualityAttributeRow): DesignedQualityAttribute {
  return {
    name: r.name,
    type: emptyToNull(r.type) as DesignedQualityAttribute["type"],
    description: emptyToNull(r.description),
  };
}

function rowToRule(r: RuleRow): DesignedRule {
  return {
    name: r.name,
    ruleType: emptyToNull(r.rule_type) as DesignedRule["ruleType"],
    description: emptyToNull(r.description),
  };
}

function rowToScenario(r: ScenarioRow): DesignedScenario {
  return {
    name: r.name,
    description: r.description,
    given: r.given,
    when: r.when_clause,
    then: r.then_clause,
  };
}

function applyStringChangeSet(
  cs: { added: string[]; removed: string[]; modified: string[] } | undefined,
): string[] {
  if (cs === undefined) return [];
  const set = new Set<string>(cs.added);
  for (const m of cs.modified) set.add(m);
  for (const r of cs.removed) set.delete(r);
  return Array.from(set);
}

function buildPartialFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null && value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function serializeProperties(
  properties:
    | { added: DesignedProperty[]; removed: string[]; modified: DesignedProperty[] }
    | undefined,
): string {
  if (properties === undefined) return "[]";
  const map = new Map<string, DesignedProperty>();
  for (const p of properties.added) map.set(p.name, p);
  for (const p of properties.modified) {
    const existing = map.get(p.name);
    map.set(p.name, existing === undefined ? p : { ...existing, ...p });
  }
  for (const r of properties.removed) map.delete(r);
  return JSON.stringify(Array.from(map.values()));
}

function deserializeProperties(json: string): DesignedProperty[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as DesignedProperty[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function deserializeImplements(json: string): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as string[];
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function emptyToNull(value: string): string | null {
  return value === "" ? null : value;
}
