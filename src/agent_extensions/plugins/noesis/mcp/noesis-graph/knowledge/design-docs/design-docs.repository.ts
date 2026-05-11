import { Injectable } from "@nestjs/common";
import { existsSync, unlinkSync } from "fs";
import { z } from "zod";
import {
  DesignDocFileNewSchema,
  type DesignDocFileNew,
  type DesignedBehaviourNew,
  type DesignedBoundedContextNew,
  type DesignedBuildingBlockNew,
  type DesignedDomainModuleNew,
  type DesignedPropertyNew,
  type DesignedQualityAttributeNew,
  type DesignedRuleNew,
  type DesignedScenarioNew,
  type StringChangeSet,
} from "../../../../shared-contracts/design-doc-new.js";
import {
  computeFileSha,
  designDocCanonicalPath,
  findDesignDocFileById,
  readSidecar,
  writeSidecar,
} from "../../../../shared-contracts/source-files.js";
import { DatabaseService } from "../../database/database.service.js";

// Schema notes:
// - Every nested design-doc entity (BoundedContext / DomainModule / BuildingBlock /
//   Behaviour / Property / Rule / Scenario / QualityAttribute) is a first-class node
//   so the graph is a full index of the on-disk sidecar (see plugin CLAUDE.md
//   "Graph model").
// - ChangeSet slots become *separate* edges per slot: HAS_ADDED_* and HAS_MODIFIED_*.
//   "removed" entries carry only a name (no body), so they stay as scalar STRING[]
//   `removed_<kind>_names` lists on the parent — the only sanctioned exception to
//   the rel-table rule, applied uniformly because the data simply doesn't have a
//   node to model.
// - `building_block.implements` and `behaviour.input/output/used_building_blocks`
//   are name references that may resolve to BuildingBlocks in this doc, in another
//   doc, or to entities not yet declared. They stay scalar STRING[] for that
//   reason — promoting them to edges would require global scope resolution that
//   the file model doesn't carry.
// - `behaviour.actor` is an Actor reference (Actor nodes are graph-global). When
//   the named actor is declared on the same doc it is linked via
//   BEHAVIOUR_PERFORMED_BY_ACTOR; the scalar `actor` field stays so cross-doc
//   references survive even when the actor hasn't been declared elsewhere yet.
// - Every nested node carries `design_doc_id` so the owned subgraph can be wiped
//   on re-index without traversing edges per label.
const SCHEMA_STATEMENTS = [
  "CREATE NODE TABLE IF NOT EXISTS DesignDoc(" +
    "id STRING, sha STRING, name STRING, name_locked BOOLEAN DEFAULT false, " +
    "description STRING, description_locked BOOLEAN DEFAULT false, " +
    "implemented BOOLEAN DEFAULT false, source_path STRING, date STRING, " +
    "removed_bounded_context_names STRING[], " +
    "PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS Actor(" +
    "name STRING, description STRING, description_locked BOOLEAN DEFAULT false, " +
    "PRIMARY KEY(name))",
  "CREATE NODE TABLE IF NOT EXISTS DesignedBoundedContext(" +
    "id STRING, design_doc_id STRING, " +
    "name STRING, name_locked BOOLEAN DEFAULT false, " +
    "description STRING, description_locked BOOLEAN DEFAULT false, " +
    "removed_module_names STRING[], " +
    "removed_building_block_names STRING[], " +
    "removed_quality_attribute_names STRING[], " +
    "PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DesignedDomainModule(" +
    "id STRING, design_doc_id STRING, " +
    "name STRING, name_locked BOOLEAN DEFAULT false, " +
    "description STRING, description_locked BOOLEAN DEFAULT false, " +
    "removed_building_block_names STRING[], " +
    "removed_quality_attribute_names STRING[], " +
    "PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DesignedBuildingBlock(" +
    "id STRING, design_doc_id STRING, " +
    "name STRING, name_locked BOOLEAN DEFAULT false, " +
    "type STRING, type_locked BOOLEAN DEFAULT false, " +
    "description STRING, description_locked BOOLEAN DEFAULT false, " +
    "implements STRING[], " +
    "removed_property_names STRING[], " +
    "removed_behaviour_names STRING[], " +
    "removed_rule_names STRING[], " +
    "removed_scenario_names STRING[], " +
    "removed_quality_attribute_names STRING[], " +
    "PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DesignedBehaviour(" +
    "id STRING, design_doc_id STRING, " +
    "name STRING, name_locked BOOLEAN DEFAULT false, " +
    "description STRING, description_locked BOOLEAN DEFAULT false, " +
    "type STRING, type_locked BOOLEAN DEFAULT false, " +
    "is_public BOOLEAN DEFAULT false, " +
    "actor STRING, actor_locked BOOLEAN DEFAULT false, " +
    "input_added STRING[], input_modified STRING[], input_removed STRING[], " +
    "output_added STRING[], output_modified STRING[], output_removed STRING[], " +
    "used_building_blocks_added STRING[], used_building_blocks_modified STRING[], " +
    "used_building_blocks_removed STRING[], " +
    "removed_rule_names STRING[], " +
    "removed_scenario_names STRING[], " +
    "removed_quality_attribute_names STRING[], " +
    "PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DesignedProperty(" +
    "id STRING, design_doc_id STRING, " +
    "name STRING, name_locked BOOLEAN DEFAULT false, " +
    "type STRING, type_locked BOOLEAN DEFAULT false, " +
    "description STRING, description_locked BOOLEAN DEFAULT false, " +
    "nullable BOOLEAN DEFAULT false, collection BOOLEAN DEFAULT false, " +
    "PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DesignedRule(" +
    "id STRING, design_doc_id STRING, " +
    "name STRING, name_locked BOOLEAN DEFAULT false, " +
    "rule_type STRING, " +
    "description STRING, description_locked BOOLEAN DEFAULT false, " +
    "PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DesignedScenario(" +
    "id STRING, design_doc_id STRING, " +
    "name STRING, name_locked BOOLEAN DEFAULT false, " +
    "description STRING, description_locked BOOLEAN DEFAULT false, " +
    "given STRING, given_locked BOOLEAN DEFAULT false, " +
    "when_clause STRING, when_locked BOOLEAN DEFAULT false, " +
    "then_clause STRING, then_locked BOOLEAN DEFAULT false, " +
    "PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS DesignedQualityAttribute(" +
    "id STRING, design_doc_id STRING, " +
    "name STRING, name_locked BOOLEAN DEFAULT false, " +
    "type STRING, " +
    "description STRING, description_locked BOOLEAN DEFAULT false, " +
    "PRIMARY KEY(id))",
  "CREATE REL TABLE IF NOT EXISTS DESIGNDOC_HAS_ACTOR(FROM DesignDoc TO Actor)",
  "CREATE REL TABLE IF NOT EXISTS DESIGNDOC_HAS_ADDED_BOUNDED_CONTEXT(FROM DesignDoc TO DesignedBoundedContext)",
  "CREATE REL TABLE IF NOT EXISTS DESIGNDOC_HAS_MODIFIED_BOUNDED_CONTEXT(FROM DesignDoc TO DesignedBoundedContext)",
  "CREATE REL TABLE IF NOT EXISTS BOUNDED_CONTEXT_HAS_ADDED_MODULE(FROM DesignedBoundedContext TO DesignedDomainModule)",
  "CREATE REL TABLE IF NOT EXISTS BOUNDED_CONTEXT_HAS_MODIFIED_MODULE(FROM DesignedBoundedContext TO DesignedDomainModule)",
  "CREATE REL TABLE IF NOT EXISTS BOUNDED_CONTEXT_HAS_ADDED_BUILDING_BLOCK(FROM DesignedBoundedContext TO DesignedBuildingBlock)",
  "CREATE REL TABLE IF NOT EXISTS BOUNDED_CONTEXT_HAS_MODIFIED_BUILDING_BLOCK(FROM DesignedBoundedContext TO DesignedBuildingBlock)",
  "CREATE REL TABLE IF NOT EXISTS BOUNDED_CONTEXT_HAS_ADDED_QUALITY_ATTRIBUTE(FROM DesignedBoundedContext TO DesignedQualityAttribute)",
  "CREATE REL TABLE IF NOT EXISTS BOUNDED_CONTEXT_HAS_MODIFIED_QUALITY_ATTRIBUTE(FROM DesignedBoundedContext TO DesignedQualityAttribute)",
  "CREATE REL TABLE IF NOT EXISTS DOMAIN_MODULE_HAS_ADDED_BUILDING_BLOCK(FROM DesignedDomainModule TO DesignedBuildingBlock)",
  "CREATE REL TABLE IF NOT EXISTS DOMAIN_MODULE_HAS_MODIFIED_BUILDING_BLOCK(FROM DesignedDomainModule TO DesignedBuildingBlock)",
  "CREATE REL TABLE IF NOT EXISTS DOMAIN_MODULE_HAS_ADDED_QUALITY_ATTRIBUTE(FROM DesignedDomainModule TO DesignedQualityAttribute)",
  "CREATE REL TABLE IF NOT EXISTS DOMAIN_MODULE_HAS_MODIFIED_QUALITY_ATTRIBUTE(FROM DesignedDomainModule TO DesignedQualityAttribute)",
  "CREATE REL TABLE IF NOT EXISTS BUILDING_BLOCK_HAS_ADDED_BEHAVIOUR(FROM DesignedBuildingBlock TO DesignedBehaviour)",
  "CREATE REL TABLE IF NOT EXISTS BUILDING_BLOCK_HAS_MODIFIED_BEHAVIOUR(FROM DesignedBuildingBlock TO DesignedBehaviour)",
  "CREATE REL TABLE IF NOT EXISTS BUILDING_BLOCK_HAS_ADDED_PROPERTY(FROM DesignedBuildingBlock TO DesignedProperty)",
  "CREATE REL TABLE IF NOT EXISTS BUILDING_BLOCK_HAS_MODIFIED_PROPERTY(FROM DesignedBuildingBlock TO DesignedProperty)",
  "CREATE REL TABLE IF NOT EXISTS BUILDING_BLOCK_HAS_ADDED_RULE(FROM DesignedBuildingBlock TO DesignedRule)",
  "CREATE REL TABLE IF NOT EXISTS BUILDING_BLOCK_HAS_MODIFIED_RULE(FROM DesignedBuildingBlock TO DesignedRule)",
  "CREATE REL TABLE IF NOT EXISTS BUILDING_BLOCK_HAS_ADDED_SCENARIO(FROM DesignedBuildingBlock TO DesignedScenario)",
  "CREATE REL TABLE IF NOT EXISTS BUILDING_BLOCK_HAS_MODIFIED_SCENARIO(FROM DesignedBuildingBlock TO DesignedScenario)",
  "CREATE REL TABLE IF NOT EXISTS BUILDING_BLOCK_HAS_ADDED_QUALITY_ATTRIBUTE(FROM DesignedBuildingBlock TO DesignedQualityAttribute)",
  "CREATE REL TABLE IF NOT EXISTS BUILDING_BLOCK_HAS_MODIFIED_QUALITY_ATTRIBUTE(FROM DesignedBuildingBlock TO DesignedQualityAttribute)",
  "CREATE REL TABLE IF NOT EXISTS BEHAVIOUR_HAS_ADDED_RULE(FROM DesignedBehaviour TO DesignedRule)",
  "CREATE REL TABLE IF NOT EXISTS BEHAVIOUR_HAS_MODIFIED_RULE(FROM DesignedBehaviour TO DesignedRule)",
  "CREATE REL TABLE IF NOT EXISTS BEHAVIOUR_HAS_ADDED_SCENARIO(FROM DesignedBehaviour TO DesignedScenario)",
  "CREATE REL TABLE IF NOT EXISTS BEHAVIOUR_HAS_MODIFIED_SCENARIO(FROM DesignedBehaviour TO DesignedScenario)",
  "CREATE REL TABLE IF NOT EXISTS BEHAVIOUR_HAS_ADDED_QUALITY_ATTRIBUTE(FROM DesignedBehaviour TO DesignedQualityAttribute)",
  "CREATE REL TABLE IF NOT EXISTS BEHAVIOUR_HAS_MODIFIED_QUALITY_ATTRIBUTE(FROM DesignedBehaviour TO DesignedQualityAttribute)",
  "CREATE REL TABLE IF NOT EXISTS BEHAVIOUR_PERFORMED_BY_ACTOR(FROM DesignedBehaviour TO Actor)",
];

const NESTED_NODE_LABELS = [
  "DesignedBehaviour",
  "DesignedProperty",
  "DesignedRule",
  "DesignedScenario",
  "DesignedQualityAttribute",
  "DesignedBuildingBlock",
  "DesignedDomainModule",
  "DesignedBoundedContext",
];

const PathRowSchema = z.object({
  id: z.string(),
  sha: z.string(),
  source_path: z.string(),
});
const StoredDesignDocRowSchema = z.object({
  id: z.string(),
  sha: z.string(),
  name: z.string(),
  name_locked: z.boolean(),
  description: z.string(),
  description_locked: z.boolean(),
  implemented: z.boolean(),
  source_path: z.string(),
});

const ImplementedRowSchema = z.object({
  implemented: z.boolean().nullable().optional(),
});

const ActorRowSchema = z.object({
  name: z.string(),
  description: z.string(),
  description_locked: z.boolean(),
});

export interface StoredDesignDoc {
  id: string;
  sha: string;
  name: string;
  name_locked: boolean;
  description: string;
  description_locked: boolean;
  implemented: boolean;
  source_path: string;
}

export interface StoredActor {
  name: string;
  description: string;
  description_locked: boolean;
}

@Injectable()
export class DesignDocsRepository {
  constructor(private readonly db: DatabaseService) {}

  canonicalPath(projectDir: string, id: string, name: string): string {
    return designDocCanonicalPath(projectDir, id, name);
  }

  async delete(designDocId: string): Promise<void> {
    await this.deleteOwnedSubgraph(designDocId);
    await this.db.query(
      "MATCH (d:DesignDoc)-[r:DESIGNDOC_HAS_ACTOR]->(:Actor) WHERE d.id = $id DELETE r",
      { id: designDocId },
    );
    await this.db.query(
      "MATCH (d:DesignDoc) WHERE d.id = $id DETACH DELETE d",
      { id: designDocId },
    );
    await this.pruneOrphanActors();
  }

  deleteFile(absPath: string): void {
    if (existsSync(absPath)) unlinkSync(absPath);
  }

  async exists(designDocId: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      "MATCH (d:DesignDoc) WHERE d.id = $id RETURN d.id AS id LIMIT 1",
      { id: designDocId },
    );
    return rows.length > 0;
  }

  fileSha(absPath: string): string {
    return computeFileSha(absPath);
  }

  findFileById(projectDir: string, id: string): string | null {
    return findDesignDocFileById(projectDir, id);
  }

  async initSchema(): Promise<void> {
    for (const stmt of SCHEMA_STATEMENTS) {
      await this.db.query(stmt);
    }
  }

  async listActors(): Promise<StoredActor[]> {
    const rows = await this.db.query<unknown>(
      "MATCH (a:Actor) RETURN a.name AS name, a.description AS description, " +
        "a.description_locked AS description_locked ORDER BY a.name",
    );
    return z.array(ActorRowSchema).parse(rows);
  }

  async listAll(): Promise<StoredDesignDoc[]> {
    const rows = await this.db.query<unknown>(
      "MATCH (d:DesignDoc) RETURN " +
        "d.id AS id, d.sha AS sha, d.name AS name, d.name_locked AS name_locked, " +
        "d.description AS description, d.description_locked AS description_locked, " +
        "d.implemented AS implemented, d.source_path AS source_path " +
        "ORDER BY d.id",
    );
    return z.array(StoredDesignDocRowSchema).parse(rows);
  }

  async listAllStoredFiles(): Promise<
    Array<{ id: string; path: string; sha: string }>
  > {
    const rows = await this.db.query<unknown>(
      "MATCH (d:DesignDoc) RETURN d.id AS id, d.sha AS sha, d.source_path AS source_path",
    );
    return z.array(PathRowSchema).parse(rows).map((r) => ({
      id: r.id,
      sha: r.sha,
      path: r.source_path,
    }));
  }

  async read(designDocId: string): Promise<StoredDesignDoc | null> {
    const rows = await this.db.query<unknown>(
      "MATCH (d:DesignDoc) WHERE d.id = $id RETURN " +
        "d.id AS id, d.sha AS sha, d.name AS name, d.name_locked AS name_locked, " +
        "d.description AS description, d.description_locked AS description_locked, " +
        "d.implemented AS implemented, d.source_path AS source_path LIMIT 1",
      { id: designDocId },
    );
    if (rows.length === 0) return null;
    return StoredDesignDocRowSchema.parse(rows[0]);
  }

  readFile(absPath: string): DesignDocFileNew {
    return readSidecar(absPath, DesignDocFileNewSchema);
  }

  async readImplementedFlag(designDocId: string): Promise<boolean | null> {
    const rows = await this.db.query<unknown>(
      "MATCH (d:DesignDoc) WHERE d.id = $id RETURN d.implemented AS implemented LIMIT 1",
      { id: designDocId },
    );
    if (rows.length === 0) return null;
    return ImplementedRowSchema.parse(rows[0]).implemented ?? false;
  }

  async upsert(
    file: DesignDocFileNew,
    sha: string,
    sourcePath: string,
  ): Promise<void> {
    await this.deleteOwnedSubgraph(file.id);
    await this.db.query(
      "MERGE (d:DesignDoc {id: $id}) SET " +
        "d.sha = $sha, d.name = $name, d.name_locked = $name_locked, " +
        "d.description = $description, d.description_locked = $description_locked, " +
        "d.implemented = $implemented, d.source_path = $source_path, " +
        "d.date = $date, d.removed_bounded_context_names = $removed_bc_names",
      {
        id: file.id,
        sha,
        name: file.name,
        name_locked: file.name_locked,
        description: file.description,
        description_locked: file.description_locked,
        implemented: file.implemented,
        source_path: sourcePath,
        date: file.date,
        removed_bc_names: file.boundedContexts?.removed ?? [],
      },
    );
    await this.db.query(
      "MATCH (d:DesignDoc)-[r:DESIGNDOC_HAS_ACTOR]->(:Actor) WHERE d.id = $id DELETE r",
      { id: file.id },
    );
    const declaredActorNames = new Set<string>();
    for (const actor of file.actors) {
      declaredActorNames.add(actor.name);
      await this.db.query(
        "MERGE (a:Actor {name: $name}) SET " +
          "a.description = $description, a.description_locked = $description_locked",
        {
          name: actor.name,
          description: actor.description ?? "",
          description_locked: actor.description_locked,
        },
      );
      await this.db.query(
        "MATCH (d:DesignDoc), (a:Actor) WHERE d.id = $did AND a.name = $name " +
          "CREATE (d)-[:DESIGNDOC_HAS_ACTOR]->(a)",
        { did: file.id, name: actor.name },
      );
    }
    for (const bc of file.boundedContexts?.added ?? []) {
      await this.upsertBoundedContext(file.id, bc, "added", declaredActorNames);
    }
    for (const bc of file.boundedContexts?.modified ?? []) {
      await this.upsertBoundedContext(
        file.id,
        bc,
        "modified",
        declaredActorNames,
      );
    }
    await this.pruneOrphanActors();
  }

  writeFile(absPath: string, file: DesignDocFileNew): void {
    writeSidecar(absPath, file, DesignDocFileNewSchema);
  }

  async upsertActor(actor: {
    name: string;
    description: string | null;
  }): Promise<void> {
    await this.db.query(
      "MERGE (a:Actor {name: $name}) SET " +
        "a.description = $description, a.description_locked = false",
      {
        name: actor.name,
        description: actor.description ?? "",
      },
    );
  }

  async writeImplementedFlag(
    designDocId: string,
    implemented: boolean,
  ): Promise<void> {
    await this.db.query(
      "MATCH (d:DesignDoc) WHERE d.id = $id SET d.implemented = $implemented",
      { id: designDocId, implemented },
    );
  }

  private async deleteOwnedSubgraph(designDocId: string): Promise<void> {
    for (const label of NESTED_NODE_LABELS) {
      await this.db.query(
        `MATCH (n:${label}) WHERE n.design_doc_id = $id DETACH DELETE n`,
        { id: designDocId },
      );
    }
  }

  private async pruneOrphanActors(): Promise<void> {
    await this.db.query(
      "MATCH (a:Actor) WHERE NOT EXISTS { MATCH (:DesignDoc)-[:DESIGNDOC_HAS_ACTOR]->(a) } " +
        "AND NOT EXISTS { MATCH (:DesignedBehaviour)-[:BEHAVIOUR_PERFORMED_BY_ACTOR]->(a) } " +
        "DETACH DELETE a",
    );
  }

  private async upsertBoundedContext(
    designDocId: string,
    bc: DesignedBoundedContextNew,
    slot: ChangeSlot,
    declaredActorNames: Set<string>,
  ): Promise<void> {
    const id = boundedContextId(designDocId, bc.name);
    await this.db.query(
      "CREATE (n:DesignedBoundedContext {" +
        "id: $id, design_doc_id: $design_doc_id, " +
        "name: $name, name_locked: $name_locked, " +
        "description: $description, description_locked: $description_locked, " +
        "removed_module_names: $removed_module_names, " +
        "removed_building_block_names: $removed_building_block_names, " +
        "removed_quality_attribute_names: $removed_quality_attribute_names})",
      {
        id,
        design_doc_id: designDocId,
        name: bc.name,
        name_locked: bc.name_locked,
        description: bc.description ?? "",
        description_locked: bc.description_locked,
        removed_module_names: bc.modules?.removed ?? [],
        removed_building_block_names: bc.buildingBlocks?.removed ?? [],
        removed_quality_attribute_names: bc.qualityAttributes?.removed ?? [],
      },
    );
    const edge =
      slot === "added"
        ? "DESIGNDOC_HAS_ADDED_BOUNDED_CONTEXT"
        : "DESIGNDOC_HAS_MODIFIED_BOUNDED_CONTEXT";
    await this.db.query(
      `MATCH (d:DesignDoc), (n:DesignedBoundedContext) WHERE d.id = $did AND n.id = $nid CREATE (d)-[:${edge}]->(n)`,
      { did: designDocId, nid: id },
    );
    for (const m of bc.modules?.added ?? []) {
      await this.upsertModule(designDocId, id, bc.name, m, "added", declaredActorNames);
    }
    for (const m of bc.modules?.modified ?? []) {
      await this.upsertModule(
        designDocId,
        id,
        bc.name,
        m,
        "modified",
        declaredActorNames,
      );
    }
    for (const bb of bc.buildingBlocks?.added ?? []) {
      await this.upsertBuildingBlock(
        designDocId,
        { parentNodeId: id, parentLabel: "DesignedBoundedContext", path: bcPath(bc.name) },
        bb,
        "added",
        declaredActorNames,
      );
    }
    for (const bb of bc.buildingBlocks?.modified ?? []) {
      await this.upsertBuildingBlock(
        designDocId,
        { parentNodeId: id, parentLabel: "DesignedBoundedContext", path: bcPath(bc.name) },
        bb,
        "modified",
        declaredActorNames,
      );
    }
    for (const qa of bc.qualityAttributes?.added ?? []) {
      await this.upsertQualityAttribute(
        designDocId,
        { parentNodeId: id, parentLabel: "DesignedBoundedContext", path: bcPath(bc.name) },
        qa,
        "added",
      );
    }
    for (const qa of bc.qualityAttributes?.modified ?? []) {
      await this.upsertQualityAttribute(
        designDocId,
        { parentNodeId: id, parentLabel: "DesignedBoundedContext", path: bcPath(bc.name) },
        qa,
        "modified",
      );
    }
  }

  private async upsertModule(
    designDocId: string,
    bcNodeId: string,
    bcName: string,
    m: DesignedDomainModuleNew,
    slot: ChangeSlot,
    declaredActorNames: Set<string>,
  ): Promise<void> {
    const id = moduleId(designDocId, bcName, m.name);
    await this.db.query(
      "CREATE (n:DesignedDomainModule {" +
        "id: $id, design_doc_id: $design_doc_id, " +
        "name: $name, name_locked: $name_locked, " +
        "description: $description, description_locked: $description_locked, " +
        "removed_building_block_names: $removed_building_block_names, " +
        "removed_quality_attribute_names: $removed_quality_attribute_names})",
      {
        id,
        design_doc_id: designDocId,
        name: m.name,
        name_locked: m.name_locked,
        description: m.description ?? "",
        description_locked: m.description_locked,
        removed_building_block_names: m.buildingBlocks?.removed ?? [],
        removed_quality_attribute_names: m.qualityAttributes?.removed ?? [],
      },
    );
    const edge =
      slot === "added"
        ? "BOUNDED_CONTEXT_HAS_ADDED_MODULE"
        : "BOUNDED_CONTEXT_HAS_MODIFIED_MODULE";
    await this.db.query(
      `MATCH (p:DesignedBoundedContext), (n:DesignedDomainModule) WHERE p.id = $pid AND n.id = $nid CREATE (p)-[:${edge}]->(n)`,
      { pid: bcNodeId, nid: id },
    );
    for (const bb of m.buildingBlocks?.added ?? []) {
      await this.upsertBuildingBlock(
        designDocId,
        {
          parentNodeId: id,
          parentLabel: "DesignedDomainModule",
          path: modulePath(bcName, m.name),
        },
        bb,
        "added",
        declaredActorNames,
      );
    }
    for (const bb of m.buildingBlocks?.modified ?? []) {
      await this.upsertBuildingBlock(
        designDocId,
        {
          parentNodeId: id,
          parentLabel: "DesignedDomainModule",
          path: modulePath(bcName, m.name),
        },
        bb,
        "modified",
        declaredActorNames,
      );
    }
    for (const qa of m.qualityAttributes?.added ?? []) {
      await this.upsertQualityAttribute(
        designDocId,
        {
          parentNodeId: id,
          parentLabel: "DesignedDomainModule",
          path: modulePath(bcName, m.name),
        },
        qa,
        "added",
      );
    }
    for (const qa of m.qualityAttributes?.modified ?? []) {
      await this.upsertQualityAttribute(
        designDocId,
        {
          parentNodeId: id,
          parentLabel: "DesignedDomainModule",
          path: modulePath(bcName, m.name),
        },
        qa,
        "modified",
      );
    }
  }

  private async upsertBuildingBlock(
    designDocId: string,
    parent: ParentRef,
    bb: DesignedBuildingBlockNew,
    slot: ChangeSlot,
    declaredActorNames: Set<string>,
  ): Promise<void> {
    const id = buildingBlockId(designDocId, parent.path, bb.name);
    await this.db.query(
      "CREATE (n:DesignedBuildingBlock {" +
        "id: $id, design_doc_id: $design_doc_id, " +
        "name: $name, name_locked: $name_locked, " +
        "type: $type, type_locked: $type_locked, " +
        "description: $description, description_locked: $description_locked, " +
        "implements: $implements, " +
        "removed_property_names: $removed_property_names, " +
        "removed_behaviour_names: $removed_behaviour_names, " +
        "removed_rule_names: $removed_rule_names, " +
        "removed_scenario_names: $removed_scenario_names, " +
        "removed_quality_attribute_names: $removed_quality_attribute_names})",
      {
        id,
        design_doc_id: designDocId,
        name: bb.name,
        name_locked: bb.name_locked,
        type: bb.type ?? "",
        type_locked: bb.type_locked,
        description: bb.description ?? "",
        description_locked: bb.description_locked,
        implements: bb.implements ?? [],
        removed_property_names: bb.properties?.removed ?? [],
        removed_behaviour_names: bb.behaviours?.removed ?? [],
        removed_rule_names: bb.rules?.removed ?? [],
        removed_scenario_names: bb.scenarios?.removed ?? [],
        removed_quality_attribute_names: bb.qualityAttributes?.removed ?? [],
      },
    );
    const edge = buildingBlockEdgeName(parent.parentLabel, slot);
    await this.db.query(
      `MATCH (p:${parent.parentLabel}), (n:DesignedBuildingBlock) WHERE p.id = $pid AND n.id = $nid CREATE (p)-[:${edge}]->(n)`,
      { pid: parent.parentNodeId, nid: id },
    );
    const bbPath = buildingBlockPath(parent.path, bb.name);
    for (const prop of bb.properties?.added ?? []) {
      await this.upsertProperty(designDocId, id, bbPath, prop, "added");
    }
    for (const prop of bb.properties?.modified ?? []) {
      await this.upsertProperty(designDocId, id, bbPath, prop, "modified");
    }
    for (const bh of bb.behaviours?.added ?? []) {
      await this.upsertBehaviour(designDocId, id, bbPath, bh, "added", declaredActorNames);
    }
    for (const bh of bb.behaviours?.modified ?? []) {
      await this.upsertBehaviour(designDocId, id, bbPath, bh, "modified", declaredActorNames);
    }
    for (const r of bb.rules?.added ?? []) {
      await this.upsertRule(
        designDocId,
        { parentNodeId: id, parentLabel: "DesignedBuildingBlock", path: bbPath },
        r,
        "added",
      );
    }
    for (const r of bb.rules?.modified ?? []) {
      await this.upsertRule(
        designDocId,
        { parentNodeId: id, parentLabel: "DesignedBuildingBlock", path: bbPath },
        r,
        "modified",
      );
    }
    for (const s of bb.scenarios?.added ?? []) {
      await this.upsertScenario(
        designDocId,
        { parentNodeId: id, parentLabel: "DesignedBuildingBlock", path: bbPath },
        s,
        "added",
      );
    }
    for (const s of bb.scenarios?.modified ?? []) {
      await this.upsertScenario(
        designDocId,
        { parentNodeId: id, parentLabel: "DesignedBuildingBlock", path: bbPath },
        s,
        "modified",
      );
    }
    for (const qa of bb.qualityAttributes?.added ?? []) {
      await this.upsertQualityAttribute(
        designDocId,
        { parentNodeId: id, parentLabel: "DesignedBuildingBlock", path: bbPath },
        qa,
        "added",
      );
    }
    for (const qa of bb.qualityAttributes?.modified ?? []) {
      await this.upsertQualityAttribute(
        designDocId,
        { parentNodeId: id, parentLabel: "DesignedBuildingBlock", path: bbPath },
        qa,
        "modified",
      );
    }
  }

  private async upsertBehaviour(
    designDocId: string,
    bbNodeId: string,
    bbPath: string,
    bh: DesignedBehaviourNew,
    slot: ChangeSlot,
    declaredActorNames: Set<string>,
  ): Promise<void> {
    const id = behaviourId(designDocId, bbPath, bh.name);
    await this.db.query(
      "CREATE (n:DesignedBehaviour {" +
        "id: $id, design_doc_id: $design_doc_id, " +
        "name: $name, name_locked: $name_locked, " +
        "description: $description, description_locked: $description_locked, " +
        "type: $type, type_locked: $type_locked, " +
        "is_public: $is_public, actor: $actor, actor_locked: $actor_locked, " +
        "input_added: $input_added, input_modified: $input_modified, input_removed: $input_removed, " +
        "output_added: $output_added, output_modified: $output_modified, output_removed: $output_removed, " +
        "used_building_blocks_added: $ubb_added, used_building_blocks_modified: $ubb_modified, used_building_blocks_removed: $ubb_removed, " +
        "removed_rule_names: $removed_rule_names, " +
        "removed_scenario_names: $removed_scenario_names, " +
        "removed_quality_attribute_names: $removed_quality_attribute_names})",
      {
        id,
        design_doc_id: designDocId,
        name: bh.name,
        name_locked: bh.name_locked,
        description: bh.description ?? "",
        description_locked: bh.description_locked,
        type: bh.type ?? "",
        type_locked: bh.type_locked,
        is_public: bh.isPublic,
        actor: bh.actor ?? "",
        actor_locked: bh.actor_locked,
        ...stringChangeSetParams("input_", bh.input),
        ...stringChangeSetParams("output_", bh.output),
        ubb_added: bh.usedBuildingBlocks?.added ?? [],
        ubb_modified: bh.usedBuildingBlocks?.modified ?? [],
        ubb_removed: bh.usedBuildingBlocks?.removed ?? [],
        removed_rule_names: bh.rules?.removed ?? [],
        removed_scenario_names: bh.scenarios?.removed ?? [],
        removed_quality_attribute_names: bh.qualityAttributes?.removed ?? [],
      },
    );
    const edge =
      slot === "added"
        ? "BUILDING_BLOCK_HAS_ADDED_BEHAVIOUR"
        : "BUILDING_BLOCK_HAS_MODIFIED_BEHAVIOUR";
    await this.db.query(
      `MATCH (p:DesignedBuildingBlock), (n:DesignedBehaviour) WHERE p.id = $pid AND n.id = $nid CREATE (p)-[:${edge}]->(n)`,
      { pid: bbNodeId, nid: id },
    );
    if (bh.actor !== null && declaredActorNames.has(bh.actor)) {
      await this.db.query(
        "MATCH (n:DesignedBehaviour), (a:Actor) WHERE n.id = $nid AND a.name = $name " +
          "CREATE (n)-[:BEHAVIOUR_PERFORMED_BY_ACTOR]->(a)",
        { nid: id, name: bh.actor },
      );
    }
    const bhPath = behaviourPath(bbPath, bh.name);
    for (const r of bh.rules?.added ?? []) {
      await this.upsertRule(
        designDocId,
        { parentNodeId: id, parentLabel: "DesignedBehaviour", path: bhPath },
        r,
        "added",
      );
    }
    for (const r of bh.rules?.modified ?? []) {
      await this.upsertRule(
        designDocId,
        { parentNodeId: id, parentLabel: "DesignedBehaviour", path: bhPath },
        r,
        "modified",
      );
    }
    for (const s of bh.scenarios?.added ?? []) {
      await this.upsertScenario(
        designDocId,
        { parentNodeId: id, parentLabel: "DesignedBehaviour", path: bhPath },
        s,
        "added",
      );
    }
    for (const s of bh.scenarios?.modified ?? []) {
      await this.upsertScenario(
        designDocId,
        { parentNodeId: id, parentLabel: "DesignedBehaviour", path: bhPath },
        s,
        "modified",
      );
    }
    for (const qa of bh.qualityAttributes?.added ?? []) {
      await this.upsertQualityAttribute(
        designDocId,
        { parentNodeId: id, parentLabel: "DesignedBehaviour", path: bhPath },
        qa,
        "added",
      );
    }
    for (const qa of bh.qualityAttributes?.modified ?? []) {
      await this.upsertQualityAttribute(
        designDocId,
        { parentNodeId: id, parentLabel: "DesignedBehaviour", path: bhPath },
        qa,
        "modified",
      );
    }
  }

  private async upsertProperty(
    designDocId: string,
    bbNodeId: string,
    bbPath: string,
    prop: DesignedPropertyNew,
    slot: ChangeSlot,
  ): Promise<void> {
    const id = propertyId(designDocId, bbPath, prop.name);
    await this.db.query(
      "CREATE (n:DesignedProperty {" +
        "id: $id, design_doc_id: $design_doc_id, " +
        "name: $name, name_locked: $name_locked, " +
        "type: $type, type_locked: $type_locked, " +
        "description: $description, description_locked: $description_locked, " +
        "nullable: $nullable, collection: $collection})",
      {
        id,
        design_doc_id: designDocId,
        name: prop.name,
        name_locked: prop.name_locked,
        type: prop.type ?? "",
        type_locked: prop.type_locked,
        description: prop.description ?? "",
        description_locked: prop.description_locked,
        nullable: prop.nullable ?? false,
        collection: prop.collection ?? false,
      },
    );
    const edge =
      slot === "added"
        ? "BUILDING_BLOCK_HAS_ADDED_PROPERTY"
        : "BUILDING_BLOCK_HAS_MODIFIED_PROPERTY";
    await this.db.query(
      `MATCH (p:DesignedBuildingBlock), (n:DesignedProperty) WHERE p.id = $pid AND n.id = $nid CREATE (p)-[:${edge}]->(n)`,
      { pid: bbNodeId, nid: id },
    );
  }

  private async upsertRule(
    designDocId: string,
    parent: ParentRef,
    r: DesignedRuleNew,
    slot: ChangeSlot,
  ): Promise<void> {
    const id = ruleId(designDocId, parent.path, r.name);
    await this.db.query(
      "CREATE (n:DesignedRule {" +
        "id: $id, design_doc_id: $design_doc_id, " +
        "name: $name, name_locked: $name_locked, " +
        "rule_type: $rule_type, " +
        "description: $description, description_locked: $description_locked})",
      {
        id,
        design_doc_id: designDocId,
        name: r.name,
        name_locked: r.name_locked,
        rule_type: r.ruleType ?? "",
        description: r.description ?? "",
        description_locked: r.description_locked,
      },
    );
    const edge = childEdgeName(parent.parentLabel, "RULE", slot);
    await this.db.query(
      `MATCH (p:${parent.parentLabel}), (n:DesignedRule) WHERE p.id = $pid AND n.id = $nid CREATE (p)-[:${edge}]->(n)`,
      { pid: parent.parentNodeId, nid: id },
    );
  }

  private async upsertScenario(
    designDocId: string,
    parent: ParentRef,
    s: DesignedScenarioNew,
    slot: ChangeSlot,
  ): Promise<void> {
    const id = scenarioId(designDocId, parent.path, s.name);
    await this.db.query(
      "CREATE (n:DesignedScenario {" +
        "id: $id, design_doc_id: $design_doc_id, " +
        "name: $name, name_locked: $name_locked, " +
        "description: $description, description_locked: $description_locked, " +
        "given: $given, given_locked: $given_locked, " +
        "when_clause: $when_clause, when_locked: $when_locked, " +
        "then_clause: $then_clause, then_locked: $then_locked})",
      {
        id,
        design_doc_id: designDocId,
        name: s.name,
        name_locked: s.name_locked,
        description: s.description,
        description_locked: s.description_locked,
        given: s.given,
        given_locked: s.given_locked,
        when_clause: s.when,
        when_locked: s.when_locked,
        then_clause: s.then,
        then_locked: s.then_locked,
      },
    );
    const edge = childEdgeName(parent.parentLabel, "SCENARIO", slot);
    await this.db.query(
      `MATCH (p:${parent.parentLabel}), (n:DesignedScenario) WHERE p.id = $pid AND n.id = $nid CREATE (p)-[:${edge}]->(n)`,
      { pid: parent.parentNodeId, nid: id },
    );
  }

  private async upsertQualityAttribute(
    designDocId: string,
    parent: ParentRef,
    qa: DesignedQualityAttributeNew,
    slot: ChangeSlot,
  ): Promise<void> {
    const id = qualityAttributeId(designDocId, parent.path, qa.name);
    await this.db.query(
      "CREATE (n:DesignedQualityAttribute {" +
        "id: $id, design_doc_id: $design_doc_id, " +
        "name: $name, name_locked: $name_locked, " +
        "type: $type, " +
        "description: $description, description_locked: $description_locked})",
      {
        id,
        design_doc_id: designDocId,
        name: qa.name,
        name_locked: qa.name_locked,
        type: qa.type ?? "",
        description: qa.description ?? "",
        description_locked: qa.description_locked,
      },
    );
    const edge = childEdgeName(parent.parentLabel, "QUALITY_ATTRIBUTE", slot);
    await this.db.query(
      `MATCH (p:${parent.parentLabel}), (n:DesignedQualityAttribute) WHERE p.id = $pid AND n.id = $nid CREATE (p)-[:${edge}]->(n)`,
      { pid: parent.parentNodeId, nid: id },
    );
  }
}

type ChangeSlot = "added" | "modified";

type ParentLabel =
  | "DesignDoc"
  | "DesignedBoundedContext"
  | "DesignedDomainModule"
  | "DesignedBuildingBlock"
  | "DesignedBehaviour";

interface ParentRef {
  parentNodeId: string;
  parentLabel: ParentLabel;
  path: string;
}

function bcPath(bcName: string): string {
  return `BC:${bcName}`;
}

function modulePath(bcName: string, moduleName: string): string {
  return `${bcPath(bcName)}|M:${moduleName}`;
}

function buildingBlockPath(parentPath: string, bbName: string): string {
  return `${parentPath}|BB:${bbName}`;
}

function behaviourPath(bbPath: string, behaviourName: string): string {
  return `${bbPath}|BH:${behaviourName}`;
}

function boundedContextId(designDocId: string, name: string): string {
  return `${designDocId}|${bcPath(name)}`;
}

function moduleId(designDocId: string, bcName: string, moduleName: string): string {
  return `${designDocId}|${modulePath(bcName, moduleName)}`;
}

function buildingBlockId(
  designDocId: string,
  parentPath: string,
  bbName: string,
): string {
  return `${designDocId}|${buildingBlockPath(parentPath, bbName)}`;
}

function behaviourId(
  designDocId: string,
  bbPath: string,
  behaviourName: string,
): string {
  return `${designDocId}|${behaviourPath(bbPath, behaviourName)}`;
}

function propertyId(
  designDocId: string,
  bbPath: string,
  propName: string,
): string {
  return `${designDocId}|${bbPath}|P:${propName}`;
}

function ruleId(
  designDocId: string,
  parentPath: string,
  ruleName: string,
): string {
  return `${designDocId}|${parentPath}|R:${ruleName}`;
}

function scenarioId(
  designDocId: string,
  parentPath: string,
  scenarioName: string,
): string {
  return `${designDocId}|${parentPath}|S:${scenarioName}`;
}

function qualityAttributeId(
  designDocId: string,
  parentPath: string,
  qaName: string,
): string {
  return `${designDocId}|${parentPath}|QA:${qaName}`;
}

function buildingBlockEdgeName(parentLabel: ParentLabel, slot: ChangeSlot): string {
  switch (parentLabel) {
    case "DesignedBoundedContext":
      return slot === "added"
        ? "BOUNDED_CONTEXT_HAS_ADDED_BUILDING_BLOCK"
        : "BOUNDED_CONTEXT_HAS_MODIFIED_BUILDING_BLOCK";
    case "DesignedDomainModule":
      return slot === "added"
        ? "DOMAIN_MODULE_HAS_ADDED_BUILDING_BLOCK"
        : "DOMAIN_MODULE_HAS_MODIFIED_BUILDING_BLOCK";
    default:
      throw new Error(`BuildingBlock cannot hang off ${parentLabel}`);
  }
}

function childEdgeName(
  parentLabel: ParentLabel,
  childKind: "RULE" | "SCENARIO" | "QUALITY_ATTRIBUTE",
  slot: ChangeSlot,
): string {
  const slotPart = slot === "added" ? "HAS_ADDED" : "HAS_MODIFIED";
  switch (parentLabel) {
    case "DesignedBoundedContext":
      if (childKind !== "QUALITY_ATTRIBUTE") {
        throw new Error(`BoundedContext cannot host ${childKind}`);
      }
      return `BOUNDED_CONTEXT_${slotPart}_${childKind}`;
    case "DesignedDomainModule":
      if (childKind !== "QUALITY_ATTRIBUTE") {
        throw new Error(`DomainModule cannot host ${childKind}`);
      }
      return `DOMAIN_MODULE_${slotPart}_${childKind}`;
    case "DesignedBuildingBlock":
      return `BUILDING_BLOCK_${slotPart}_${childKind}`;
    case "DesignedBehaviour":
      return `BEHAVIOUR_${slotPart}_${childKind}`;
    default:
      throw new Error(`Unsupported parent label ${parentLabel}`);
  }
}

function stringChangeSetParams(
  prefix: string,
  cs: StringChangeSet | undefined,
): Record<string, string[]> {
  return {
    [`${prefix}added`]: cs?.added ?? [],
    [`${prefix}modified`]: cs?.modified ?? [],
    [`${prefix}removed`]: cs?.removed ?? [],
  };
}
