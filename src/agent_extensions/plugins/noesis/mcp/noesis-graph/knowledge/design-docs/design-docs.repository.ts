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
  "CREATE NODE TABLE IF NOT EXISTS DesignDoc(id STRING, name STRING, description STRING, date STRING, source_sha STRING, edited_by_user BOOLEAN, implemented BOOLEAN DEFAULT false, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DesignedActor(id STRING, name STRING, description STRING, edited_by_user BOOLEAN DEFAULT false, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DesignedBoundedContext(id STRING, name STRING, description STRING, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DesignedDomainModule(id STRING, name STRING, full_path STRING, description STRING, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DesignedBuildingBlock(id STRING, name STRING, type STRING, description STRING, properties STRING, implements STRING, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DesignedBehaviour(id STRING, name STRING, type STRING, description STRING, is_public BOOLEAN, input STRING[], output STRING[], used_building_blocks STRING[], actor_name STRING, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DesignedRule(id STRING, name STRING, rule_type STRING, description STRING, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DesignedScenario(id STRING, name STRING, description STRING, given STRING, when_clause STRING, then_clause STRING, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DesignedQualityAttribute(id STRING, name STRING, type STRING, description STRING, PRIMARY KEY(id))",
  "CREATE REL TABLE IF NOT EXISTS DD_HAS_BC(FROM DesignDoc TO DesignedBoundedContext)",
  "CREATE REL TABLE IF NOT EXISTS DBC_HAS_MODULE(FROM DesignedBoundedContext TO DesignedDomainModule)",
  "CREATE REL TABLE IF NOT EXISTS DBC_HAS_BB(FROM DesignedBoundedContext TO DesignedBuildingBlock)",
  "CREATE REL TABLE IF NOT EXISTS DBC_HAS_QA(FROM DesignedBoundedContext TO DesignedQualityAttribute)",
  "CREATE REL TABLE IF NOT EXISTS DM_HAS_MODULE(FROM DesignedDomainModule TO DesignedDomainModule)",
  "CREATE REL TABLE IF NOT EXISTS DM_HAS_BB(FROM DesignedDomainModule TO DesignedBuildingBlock)",
  "CREATE REL TABLE IF NOT EXISTS DM_HAS_QA(FROM DesignedDomainModule TO DesignedQualityAttribute)",
  "CREATE REL TABLE IF NOT EXISTS DBB_HAS_BEHAVIOUR(FROM DesignedBuildingBlock TO DesignedBehaviour)",
  "CREATE REL TABLE IF NOT EXISTS DBB_HAS_RULE(FROM DesignedBuildingBlock TO DesignedRule)",
  "CREATE REL TABLE IF NOT EXISTS DBB_HAS_SCENARIO(FROM DesignedBuildingBlock TO DesignedScenario)",
  "CREATE REL TABLE IF NOT EXISTS DBB_HAS_QA(FROM DesignedBuildingBlock TO DesignedQualityAttribute)",
  "CREATE REL TABLE IF NOT EXISTS DBH_HAS_RULE(FROM DesignedBehaviour TO DesignedRule)",
  "CREATE REL TABLE IF NOT EXISTS DBH_HAS_SCENARIO(FROM DesignedBehaviour TO DesignedScenario)",
  "CREATE REL TABLE IF NOT EXISTS DBH_HAS_QA(FROM DesignedBehaviour TO DesignedQualityAttribute)",
  "CREATE REL TABLE IF NOT EXISTS DBH_TRIGGERED_BY(FROM DesignedBehaviour TO DesignedActor)",
];

// Row schemas describe the literal column shape as returned by Cypher queries.
// They are intentionally separate from the domain contracts, which use nested
// ChangeSets; mapping between the two happens in rowTo* and (de)serializeProperties below.
//
// Kuzu/lbug quirk: an empty STRING[] is read back as `null` even when written as
// `[]`. Every STRING[] column therefore goes through `StringArrayRow`, which
// coalesces `null` to `[]` on read. Writes always send `[]` (never `null`).
const StringArrayRow = z
  .array(z.string())
  .nullable()
  .transform((v) => v ?? []);

const NullableStringRow = z
  .string()
  .nullable()
  .transform((v) => v ?? "");

const DesignDocRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  date: NullableStringRow,
  edited_by_user: z.boolean().nullable().optional(),
  implemented: z.boolean().nullable().optional(),
});
type DesignDocRow = z.infer<typeof DesignDocRowSchema>;

const ActorRowSchema = z.object({
  name: z.string(),
  description: z.string(),
  edited_by_user: z.boolean().nullable().optional(),
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

type QaParentLabel =
  | "DesignedBoundedContext"
  | "DesignedDomainModule"
  | "DesignedBuildingBlock"
  | "DesignedBehaviour";

const QA_REL_BY_PARENT: Record<QaParentLabel, string> = {
  DesignedBoundedContext: "DBC_HAS_QA",
  DesignedDomainModule: "DM_HAS_QA",
  DesignedBuildingBlock: "DBB_HAS_QA",
  DesignedBehaviour: "DBH_HAS_QA",
};

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

  async actorExists(name: string): Promise<boolean> {
    return this.nodeExists("DesignedActor", actorNodeId(name));
  }

  async replaceDesignDoc(doc: DesignDoc, date: string): Promise<void> {
    assertGreenfieldDoc(doc);
    await this.deleteBoundedContextSubtree(doc.id);
    await this.upsertDesignDocNode(doc, date);
    if (doc.boundedContexts !== undefined) {
      for (const bc of doc.boundedContexts.added) {
        await this.createBoundedContext(doc.id, bc);
      }
    }
  }

  async deleteDesignDoc(designDocId: string): Promise<void> {
    await this.deleteBoundedContextSubtree(designDocId);
    await this.db.query(
      "MATCH (d:DesignDoc) WHERE d.id = $id DETACH DELETE d",
      { id: designDocId },
    );
  }

  async listActors(): Promise<DesignedActor[]> {
    const rawRows = await this.db.query<ActorRow>(
      "MATCH (a:DesignedActor) RETURN a.name AS name, a.description AS description, a.edited_by_user AS edited_by_user ORDER BY a.name",
    );
    return z.array(ActorRowSchema).parse(rawRows).map(rowToActor);
  }

  async listDesignDocs(): Promise<DesignDocOverview[]> {
    const rawRows = await this.db.query<DesignDocRow>(
      "MATCH (d:DesignDoc) RETURN d.id AS id, d.name AS name, d.description AS description, d.date AS date, d.edited_by_user AS edited_by_user, d.implemented AS implemented ORDER BY d.name",
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
        implemented: row.implemented ?? false,
        bounded_context_count: await this.countChildren(
          row.id,
          "DD_HAS_BC",
          "DesignedBoundedContext",
        ),
      });
    }
    return out;
  }

  async markDesignDocImplemented(designDocId: string): Promise<void> {
    if (!(await this.nodeExists("DesignDoc", designDocId))) {
      throw new Error(`DesignDoc not found: ${designDocId}`);
    }
    await this.db.query(
      "MATCH (d:DesignDoc) WHERE d.id = $id SET d.implemented = true",
      { id: designDocId },
    );
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

  async readDesignDoc(designDocId: string): Promise<DesignDoc | null> {
    const docRow = await this.fetchDesignDocRow(designDocId);
    if (docRow === null) return null;
    const boundedContexts = await this.fetchBoundedContexts(designDocId);
    return {
      id: docRow.id,
      name: docRow.name,
      description: docRow.description,
      implemented: docRow.implemented ?? false,
      boundedContexts: { added: boundedContexts, removed: [], modified: [] },
    };
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

  async upsertActor(actor: DesignedActor, markEditedByUser: boolean): Promise<void> {
    const id = actorNodeId(actor.name);
    const description = actor.description ?? "";
    if (await this.nodeExists("DesignedActor", id)) {
      await this.updateNodeFields("DesignedActor", id, {
        description,
        edited_by_user: markEditedByUser,
      });
      return;
    }
    await this.db.query(
      "CREATE (a:DesignedActor {id: $id, name: $name, description: $description, edited_by_user: $edited_by_user})",
      { id, name: actor.name, description, edited_by_user: markEditedByUser },
    );
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

  

  

  

  

  

  

  

  

  

  private async deleteBoundedContextSubtree(designDocId: string): Promise<void> {
    const labels = [
      "DesignedScenario",
      "DesignedRule",
      "DesignedBehaviour",
      "DesignedBuildingBlock",
      "DesignedDomainModule",
      "DesignedBoundedContext",
      "DesignedQualityAttribute",
    ];
    for (const label of labels) {
      await this.db.query(
        `MATCH (n:${label}) WHERE n.id STARTS WITH $prefix DETACH DELETE n`,
        { prefix: `${designDocId}|` },
      );
    }
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
      const qualityAttributes = await this.fetchQualityAttributesOf(
        "DesignedBehaviour",
        r.id,
      );
      out.push({
        name: r.name,
        description: emptyToNull(r.description),
        type: emptyToNull(r.type) as DesignedBehaviour["type"],
        input: { added: r.input, removed: [], modified: [] },
        output: { added: r.output, removed: [], modified: [] },
        usedBuildingBlocks: { added: r.used, removed: [], modified: [] },
        rules: { added: rules, removed: [], modified: [] },
        scenarios: { added: scenarios, removed: [], modified: [] },
        qualityAttributes: {
          added: qualityAttributes,
          removed: [],
          modified: [],
        },
        isPublic: Boolean(r.is_public),
        actor: emptyToNull(r.actor_name),
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
    return this.hydrateBoundedContext(row);
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
      out.push(await this.hydrateBoundedContext(r));
    }
    return out;
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
      const qualityAttributes = await this.fetchQualityAttributesOf(
        "DesignedBuildingBlock",
        r.id,
      );
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
        qualityAttributes: {
          added: qualityAttributes,
          removed: [],
          modified: [],
        },
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

  private async fetchDesignDocRow(
    designDocId: string,
  ): Promise<DesignDocRow | null> {
    const rawRows = await this.db.query<DesignDocRow>(
      "MATCH (d:DesignDoc) WHERE d.id = $id RETURN d.id AS id, d.name AS name, d.description AS description, d.date AS date, d.edited_by_user AS edited_by_user, d.implemented AS implemented LIMIT 1",
      { id: designDocId },
    );
    if (rawRows.length === 0) return null;
    return DesignDocRowSchema.parse(rawRows[0]);
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
      const qualityAttributes = await this.fetchQualityAttributesOf(
        "DesignedDomainModule",
        r.id,
      );
      out.push({
        name: r.name,
        description: emptyToNull(r.description),
        buildingBlocks: { added: buildingBlocks, removed: [], modified: [] },
        qualityAttributes: {
          added: qualityAttributes,
          removed: [],
          modified: [],
        },
      });
    }
    return out;
  }

  private async fetchQualityAttributesOf(
    parentLabel: QaParentLabel,
    parentId: string,
  ): Promise<DesignedQualityAttribute[]> {
    const rel = QA_REL_BY_PARENT[parentLabel];
    const rawRows = await this.db.query<QualityAttributeRow>(
      `MATCH (p:${parentLabel})-[:${rel}]->(q:DesignedQualityAttribute) WHERE p.id = $id ` +
        "RETURN q.name AS name, q.type AS type, q.description AS description ORDER BY q.name",
      { id: parentId },
    );
    return z
      .array(QualityAttributeRowSchema)
      .parse(rawRows)
      .map(rowToQualityAttribute);
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

  private async fetchRulesOfBehaviour(
    bhId: string,
  ): Promise<DesignedRule[]> {
    return this.fetchRules(
      "MATCH (b:DesignedBehaviour)-[:DBH_HAS_RULE]->(r:DesignedRule) WHERE b.id = $id ",
      bhId,
    );
  }

  private async fetchRulesOfBuildingBlock(
    bbId: string,
  ): Promise<DesignedRule[]> {
    return this.fetchRules(
      "MATCH (b:DesignedBuildingBlock)-[:DBB_HAS_RULE]->(r:DesignedRule) WHERE b.id = $id ",
      bbId,
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

  private async fetchScenariosOfBehaviour(
    bhId: string,
  ): Promise<DesignedScenario[]> {
    return this.fetchScenarios(
      "MATCH (b:DesignedBehaviour)-[:DBH_HAS_SCENARIO]->(s:DesignedScenario) WHERE b.id = $id ",
      bhId,
    );
  }

  private async fetchScenariosOfBuildingBlock(
    bbId: string,
  ): Promise<DesignedScenario[]> {
    return this.fetchScenarios(
      "MATCH (b:DesignedBuildingBlock)-[:DBB_HAS_SCENARIO]->(s:DesignedScenario) WHERE b.id = $id ",
      bbId,
    );
  }

  private async hydrateBoundedContext(
    row: BoundedContextRow,
  ): Promise<DesignedBoundedContext> {
    const modules = await this.fetchModules(row.id);
    const buildingBlocks = await this.fetchBuildingBlocksOfContext(row.id);
    const qualityAttributes = await this.fetchQualityAttributesOf(
      "DesignedBoundedContext",
      row.id,
    );
    return {
      name: row.name,
      description: emptyToNull(row.description),
      modules: { added: modules, removed: [], modified: [] },
      buildingBlocks: { added: buildingBlocks, removed: [], modified: [] },
      qualityAttributes: {
        added: qualityAttributes,
        removed: [],
        modified: [],
      },
    };
  }

  private async linkBehaviourToActor(
    behaviourId: string,
    actorName: string,
  ): Promise<void> {
    const actorId = actorNodeId(actorName);
    if (!(await this.nodeExists("DesignedActor", actorId))) return;
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

  private async createBehaviour(
    bbId: string,
    bh: DesignedBehaviour,
  ): Promise<void> {
    const id = behaviourNodeId(bbId, bh.name);
    const input = bh.input?.added ?? [];
    const output = bh.output?.added ?? [];
    const used = bh.usedBuildingBlocks?.added ?? [];
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

    if (bh.actor !== null && bh.actor !== undefined && bh.actor !== "") {
      await this.linkBehaviourToActor(id, bh.actor);
    }

    for (const r of bh.rules?.added ?? []) {
      await this.createRule(id, "DesignedBehaviour", r);
    }
    for (const s of bh.scenarios?.added ?? []) {
      await this.createScenario(id, "DesignedBehaviour", s);
    }
    for (const qa of bh.qualityAttributes?.added ?? []) {
      await this.createQualityAttributeAt("DesignedBehaviour", id, qa);
    }
  }

  private async createBoundedContext(
    designDocId: string,
    bc: DesignedBoundedContext,
  ): Promise<void> {
    const id = boundedContextNodeId(designDocId, bc.name);
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

    for (const mod of bc.modules?.added ?? []) {
      await this.createModule(id, mod, bc.name);
    }
    for (const bb of bc.buildingBlocks?.added ?? []) {
      await this.createBuildingBlock(id, "DesignedBoundedContext", bb);
    }
    for (const qa of bc.qualityAttributes?.added ?? []) {
      await this.createQualityAttributeAt("DesignedBoundedContext", id, qa);
    }
  }

  private async createBuildingBlock(
    containerId: string,
    containerLabel: "DesignedBoundedContext" | "DesignedDomainModule",
    bb: DesignedBuildingBlock,
  ): Promise<void> {
    const id = buildingBlockNodeId(containerId, bb.name);
    const propertiesJson = serializeProperties(bb.properties);
    const implementsJson = JSON.stringify(bb.implements ?? []);
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

    for (const bh of bb.behaviours?.added ?? []) {
      await this.createBehaviour(id, bh);
    }
    for (const r of bb.rules?.added ?? []) {
      await this.createRule(id, "DesignedBuildingBlock", r);
    }
    for (const s of bb.scenarios?.added ?? []) {
      await this.createScenario(id, "DesignedBuildingBlock", s);
    }
    for (const qa of bb.qualityAttributes?.added ?? []) {
      await this.createQualityAttributeAt("DesignedBuildingBlock", id, qa);
    }
  }

  private async upsertDesignDocNode(
    doc: DesignDoc,
    date: string,
  ): Promise<void> {
    if (await this.nodeExists("DesignDoc", doc.id)) {
      const fields: Record<string, unknown> = {
        name: doc.name,
        description: doc.description,
        date,
      };
      if (doc.implemented === true) {
        fields.implemented = true;
      }
      await this.updateNodeFields("DesignDoc", doc.id, fields);
      return;
    }
    await this.db.query(
      "CREATE (d:DesignDoc {id: $id, name: $name, description: $description, date: $date, implemented: $implemented})",
      {
        id: doc.id,
        name: doc.name,
        description: doc.description,
        date,
        implemented: doc.implemented === true,
      },
    );
  }

  private async createModule(
    bcId: string,
    mod: DesignedDomainModule,
    bcName: string,
  ): Promise<void> {
    const fullPath = `${bcName}.${mod.name}`;
    const id = moduleNodeId(bcId, fullPath);
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

    for (const bb of mod.buildingBlocks?.added ?? []) {
      await this.createBuildingBlock(id, "DesignedDomainModule", bb);
    }
    for (const qa of mod.qualityAttributes?.added ?? []) {
      await this.createQualityAttributeAt("DesignedDomainModule", id, qa);
    }
  }

  private async createQualityAttributeAt(
    parentLabel: QaParentLabel,
    parentId: string,
    qa: DesignedQualityAttribute,
  ): Promise<void> {
    const id = qualityAttributeNodeId(parentId, qa.name);
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
      parentLabel,
      parentId,
      "DesignedQualityAttribute",
      id,
      QA_REL_BY_PARENT[parentLabel],
    );
  }

  private async createRule(
    parentId: string,
    parentLabel: "DesignedBuildingBlock" | "DesignedBehaviour",
    rule: DesignedRule,
  ): Promise<void> {
    const id = ruleNodeId(parentId, rule.name);
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
  }

  private async createScenario(
    parentId: string,
    parentLabel: "DesignedBuildingBlock" | "DesignedBehaviour",
    scenario: DesignedScenario,
  ): Promise<void> {
    const id = scenarioNodeId(parentId, scenario.name);
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
  }
}

function rowToActor(r: ActorRow): DesignedActor {
  const out: DesignedActor = {
    name: r.name,
    description: emptyToNull(r.description),
  };
  if (r.edited_by_user === true) out.edited_by_user = true;
  return out;
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





function serializeProperties(
  properties:
    | { added: DesignedProperty[]; removed: string[]; modified: DesignedProperty[] }
    | undefined,
): string {
  if (properties === undefined) return "[]";
  return JSON.stringify(properties.added);
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

function assertGreenfieldDoc(doc: DesignDoc): void {
  if (doc.boundedContexts === undefined) return;
  assertGreenfieldChangeSet(doc.boundedContexts, "boundedContexts");
  for (const bc of doc.boundedContexts.added) {
    assertGreenfieldBoundedContext(bc, `boundedContexts/${bc.name}`);
  }
}

function assertGreenfieldBoundedContext(
  bc: DesignedBoundedContext,
  path: string,
): void {
  if (bc.modules !== undefined) {
    assertGreenfieldChangeSet(bc.modules, `${path}/modules`);
    for (const mod of bc.modules.added) {
      assertGreenfieldModule(mod, `${path}/modules/${mod.name}`);
    }
  }
  if (bc.buildingBlocks !== undefined) {
    assertGreenfieldChangeSet(bc.buildingBlocks, `${path}/buildingBlocks`);
    for (const bb of bc.buildingBlocks.added) {
      assertGreenfieldBuildingBlock(bb, `${path}/buildingBlocks/${bb.name}`);
    }
  }
  if (bc.qualityAttributes !== undefined) {
    assertGreenfieldChangeSet(bc.qualityAttributes, `${path}/qualityAttributes`);
  }
}

function assertGreenfieldModule(mod: DesignedDomainModule, path: string): void {
  if (mod.buildingBlocks !== undefined) {
    assertGreenfieldChangeSet(mod.buildingBlocks, `${path}/buildingBlocks`);
    for (const bb of mod.buildingBlocks.added) {
      assertGreenfieldBuildingBlock(bb, `${path}/buildingBlocks/${bb.name}`);
    }
  }
  if (mod.qualityAttributes !== undefined) {
    assertGreenfieldChangeSet(mod.qualityAttributes, `${path}/qualityAttributes`);
  }
}

function assertGreenfieldBuildingBlock(
  bb: DesignedBuildingBlock,
  path: string,
): void {
  if (bb.properties !== undefined) {
    assertGreenfieldChangeSet(bb.properties, `${path}/properties`);
  }
  if (bb.behaviours !== undefined) {
    assertGreenfieldChangeSet(bb.behaviours, `${path}/behaviours`);
    for (const bh of bb.behaviours.added) {
      assertGreenfieldBehaviour(bh, `${path}/behaviours/${bh.name}`);
    }
  }
  if (bb.rules !== undefined) {
    assertGreenfieldChangeSet(bb.rules, `${path}/rules`);
  }
  if (bb.scenarios !== undefined) {
    assertGreenfieldChangeSet(bb.scenarios, `${path}/scenarios`);
  }
  if (bb.qualityAttributes !== undefined) {
    assertGreenfieldChangeSet(bb.qualityAttributes, `${path}/qualityAttributes`);
  }
}

function assertGreenfieldBehaviour(
  bh: DesignedBehaviour,
  path: string,
): void {
  if (bh.input !== undefined) {
    assertGreenfieldChangeSet(bh.input, `${path}/input`);
  }
  if (bh.output !== undefined) {
    assertGreenfieldChangeSet(bh.output, `${path}/output`);
  }
  if (bh.usedBuildingBlocks !== undefined) {
    assertGreenfieldChangeSet(bh.usedBuildingBlocks, `${path}/usedBuildingBlocks`);
  }
  if (bh.rules !== undefined) {
    assertGreenfieldChangeSet(bh.rules, `${path}/rules`);
  }
  if (bh.scenarios !== undefined) {
    assertGreenfieldChangeSet(bh.scenarios, `${path}/scenarios`);
  }
  if (bh.qualityAttributes !== undefined) {
    assertGreenfieldChangeSet(bh.qualityAttributes, `${path}/qualityAttributes`);
  }
}

function assertGreenfieldChangeSet(
  cs: { added: unknown[]; modified: unknown[]; removed: string[] },
  path: string,
): void {
  if (cs.modified.length > 0 || cs.removed.length > 0) {
    throw new Error(
      `ChangeSet at ${path} must have empty 'modified' and 'removed' under green-field semantics; got modified=${cs.modified.length}, removed=${cs.removed.length}`,
    );
  }
}
