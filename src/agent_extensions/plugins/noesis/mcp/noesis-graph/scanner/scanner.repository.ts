import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { DatabaseService } from "../database/database.service.js";
import {
  parentPathOf,
  type Behavior,
  type BoundedContext,
  type BoundedContextBranch,
  type BuildingBlock,
  type BuildingBlockBranch,
  type DomainModelTree,
  type Module,
  type ModuleBranch,
} from "./domain-model/domain-model.js";
import type { CodeNamespace, CodeType } from "./code-structure.js";

const SCHEMA_STATEMENTS = [
  "CREATE NODE TABLE IF NOT EXISTS BoundedContext(name STRING, PRIMARY KEY(name))",
  "CREATE NODE TABLE IF NOT EXISTS Module(name STRING, fullPath STRING, PRIMARY KEY(fullPath))",
  "CREATE NODE TABLE IF NOT EXISTS BuildingBlock(id STRING, name STRING, type STRING, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS Behavior(id STRING, name STRING, actor STRING, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS CodeNamespace(name STRING, fullName STRING, language STRING, PRIMARY KEY(fullName))",
  "CREATE NODE TABLE IF NOT EXISTS CodeType(id STRING, name STRING, fullName STRING, filePath STRING, language STRING, PRIMARY KEY(id))",
  "CREATE REL TABLE IF NOT EXISTS BC_CONTAINS_MODULE(FROM BoundedContext TO Module)",
  "CREATE REL TABLE IF NOT EXISTS MODULE_CONTAINS_MODULE(FROM Module TO Module)",
  "CREATE REL TABLE IF NOT EXISTS BC_CONTAINS_BB(FROM BoundedContext TO BuildingBlock)",
  "CREATE REL TABLE IF NOT EXISTS MODULE_CONTAINS_BB(FROM Module TO BuildingBlock)",
  "CREATE REL TABLE IF NOT EXISTS BB_CONTAINS_BEHAVIOR(FROM BuildingBlock TO Behavior)",
  "CREATE REL TABLE IF NOT EXISTS BC_REPRESENTED_BY_CODE_NAMESPACE(FROM BoundedContext TO CodeNamespace)",
  "CREATE REL TABLE IF NOT EXISTS MODULE_REPRESENTED_BY_CODE_NAMESPACE(FROM Module TO CodeNamespace)",
  "CREATE REL TABLE IF NOT EXISTS BB_REPRESENTED_BY_CODE_TYPE(FROM BuildingBlock TO CodeType)",
  "CREATE REL TABLE IF NOT EXISTS CODE_TYPE_IN_CODE_NAMESPACE(FROM CodeType TO CodeNamespace)",
];

const CLEAR_STATEMENTS = [
  "MATCH (n:Behavior) DETACH DELETE n",
  "MATCH (n:BuildingBlock) DETACH DELETE n",
  "MATCH (n:CodeType) DETACH DELETE n",
  "MATCH (n:CodeNamespace) DETACH DELETE n",
  "MATCH (n:Module) DETACH DELETE n",
  "MATCH (n:BoundedContext) DETACH DELETE n",
];

// Row schemas describe the literal column shape as returned by Cypher queries.

const BoundedContextRowSchema = z.object({
  name: z.string(),
});
type BoundedContextRow = z.infer<typeof BoundedContextRowSchema>;

const ModuleRowSchema = z.object({
  name: z.string(),
  fullPath: z.string(),
});
type ModuleRow = z.infer<typeof ModuleRowSchema>;

const BuildingBlockWithContainerRowSchema = z.object({
  containerPath: z.string(),
  id: z.string(),
  name: z.string(),
  type: z.string(),
});
type BuildingBlockWithContainerRow = z.infer<typeof BuildingBlockWithContainerRowSchema>;

const BehaviorWithBbRowSchema = z.object({
  buildingBlockId: z.string(),
  id: z.string(),
  name: z.string(),
  actor: z.string(),
});
type BehaviorWithBbRow = z.infer<typeof BehaviorWithBbRowSchema>;

const BehaviorLocationRowSchema = z.object({
  id: z.string(),
  filePath: z.string(),
  typeName: z.string(),
});
type BehaviorLocationRow = z.infer<typeof BehaviorLocationRowSchema>;

@Injectable()
export class ScannerRepository {
  private readonly logger = new Logger(ScannerRepository.name);

  constructor(private readonly db: DatabaseService) {}

  async initSchema(): Promise<void> {
    for (const stmt of SCHEMA_STATEMENTS) {
      await this.db.query(stmt);
    }
    this.logger.log("Model schema initialized");
  }

  async clearModel(): Promise<void> {
    for (const stmt of CLEAR_STATEMENTS) {
      await this.db.query(stmt);
    }
  }

  async insertBoundedContext(bc: BoundedContext): Promise<void> {
    await this.db.query("CREATE (b:BoundedContext {name: $name})", {
      name: bc.name,
    });
  }

  async insertModule(mod: Module): Promise<void> {
    await this.db.query(
      "CREATE (m:Module {name: $name, fullPath: $fullPath})",
      { name: mod.name, fullPath: mod.fullPath },
    );
    await this.linkModuleToParent(mod);
  }

  async insertBuildingBlock(bb: BuildingBlock, containerPath: string, codeTypeId: string): Promise<void> {
    await this.db.query(
      "CREATE (b:BuildingBlock {id: $id, name: $name, type: $type})",
      { id: bb.id, name: bb.name, type: bb.type },
    );
    await this.linkBuildingBlockToContainer(bb.id, containerPath);
    await this.linkBuildingBlockToCodeType(bb.id, codeTypeId);
  }

  async insertBehavior(behavior: Behavior, buildingBlockId: string): Promise<void> {
    await this.db.query(
      "CREATE (x:Behavior {id: $id, name: $name, actor: $actor})",
      { id: behavior.id, name: behavior.name, actor: behavior.actor ?? "" },
    );
    await this.db.query(
      "MATCH (b:BuildingBlock), (x:Behavior) WHERE b.id = $bbId AND x.id = $behaviorId CREATE (b)-[:BB_CONTAINS_BEHAVIOR]->(x)",
      { bbId: buildingBlockId, behaviorId: behavior.id },
    );
  }

  async insertCodeNamespace(ns: CodeNamespace): Promise<void> {
    await this.db.query(
      "CREATE (n:CodeNamespace {name: $name, fullName: $fullName, language: $language})",
      { name: ns.name, fullName: ns.fullName, language: ns.language },
    );
  }

  async insertCodeType(t: CodeType, namespaceFullName: string): Promise<void> {
    await this.db.query(
      "CREATE (t:CodeType {id: $id, name: $name, fullName: $fullName, filePath: $filePath, language: $language})",
      {
        id: t.id,
        name: t.name,
        fullName: t.fullName,
        filePath: t.filePath,
        language: t.language,
      },
    );
    await this.linkCodeTypeToCodeNamespace(t.id, namespaceFullName);
  }

  async linkBoundedContextToCodeNamespace(bcName: string, nsFullName: string): Promise<void> {
    await this.db.query(
      "MATCH (bc:BoundedContext), (n:CodeNamespace) WHERE bc.name = $bcName AND n.fullName = $nsFullName CREATE (bc)-[:BC_REPRESENTED_BY_CODE_NAMESPACE]->(n)",
      { bcName, nsFullName },
    );
  }

  async linkModuleToCodeNamespace(modFullPath: string, nsFullName: string): Promise<void> {
    await this.db.query(
      "MATCH (m:Module), (n:CodeNamespace) WHERE m.fullPath = $modFullPath AND n.fullName = $nsFullName CREATE (m)-[:MODULE_REPRESENTED_BY_CODE_NAMESPACE]->(n)",
      { modFullPath, nsFullName },
    );
  }

  async getBehaviorsWithLocations(): Promise<
    Array<{ id: string; filePath: string; typeName: string; methodName: string }>
  > {
    const rawRows = await this.db.query<BehaviorLocationRow>(
      "MATCH (b:BuildingBlock)-[:BB_REPRESENTED_BY_CODE_TYPE]->(t:CodeType), " +
        "(b)-[:BB_CONTAINS_BEHAVIOR]->(x:Behavior) " +
        "RETURN x.id AS id, t.filePath AS filePath, t.name AS typeName " +
        "ORDER BY x.id",
    );
    const rows = z.array(BehaviorLocationRowSchema).parse(rawRows);
    return rows.map((r) => ({
      id: r.id,
      filePath: r.filePath,
      typeName: r.typeName,
      methodName: extractMethodNameFromBehaviorId(r.id),
    }));
  }

  async getDomainModel(): Promise<DomainModelTree> {
    const boundedContexts = z
      .array(BoundedContextRowSchema)
      .parse(
        await this.db.query<BoundedContextRow>(
          "MATCH (b:BoundedContext) RETURN b.name AS name ORDER BY b.name",
        ),
      );

    const modules = z
      .array(ModuleRowSchema)
      .parse(
        await this.db.query<ModuleRow>(
          "MATCH (m:Module) RETURN m.name AS name, m.fullPath AS fullPath ORDER BY m.name",
        ),
      );

    const bbInModules = z
      .array(BuildingBlockWithContainerRowSchema)
      .parse(
        await this.db.query<BuildingBlockWithContainerRow>(
          "MATCH (m:Module)-[:MODULE_CONTAINS_BB]->(b:BuildingBlock) RETURN m.fullPath AS containerPath, b.id AS id, b.name AS name, b.type AS type ORDER BY b.name",
        ),
      );

    const bbInBcs = z
      .array(BuildingBlockWithContainerRowSchema)
      .parse(
        await this.db.query<BuildingBlockWithContainerRow>(
          "MATCH (bc:BoundedContext)-[:BC_CONTAINS_BB]->(b:BuildingBlock) RETURN bc.name AS containerPath, b.id AS id, b.name AS name, b.type AS type ORDER BY b.name",
        ),
      );

    const behaviorRows = z
      .array(BehaviorWithBbRowSchema)
      .parse(
        await this.db.query<BehaviorWithBbRow>(
          "MATCH (b:BuildingBlock)-[:BB_CONTAINS_BEHAVIOR]->(x:Behavior) RETURN b.id AS buildingBlockId, x.id AS id, x.name AS name, x.actor AS actor ORDER BY x.name",
        ),
      );

    return buildTree(boundedContexts, modules, [...bbInModules, ...bbInBcs], behaviorRows);
  }

  private async linkModuleToParent(mod: Module): Promise<void> {
    const parentPath = parentPathOf(mod);

    const parentParts = parentPath.split(".");
    if (parentParts.length === 1) {
      await this.db.query(
        "MATCH (bc:BoundedContext), (m:Module) WHERE bc.name = $parentName AND m.fullPath = $childPath CREATE (bc)-[:BC_CONTAINS_MODULE]->(m)",
        { parentName: parentPath, childPath: mod.fullPath },
      );
    } else {
      await this.db.query(
        "MATCH (parent:Module), (child:Module) WHERE parent.fullPath = $parentPath AND child.fullPath = $childPath CREATE (parent)-[:MODULE_CONTAINS_MODULE]->(child)",
        { parentPath, childPath: mod.fullPath },
      );
    }
  }

  private async linkBuildingBlockToContainer(bbId: string, containerPath: string): Promise<void> {
    if (containerPath.includes(".")) {
      await this.db.query(
        "MATCH (m:Module), (b:BuildingBlock) WHERE m.fullPath = $containerPath AND b.id = $id CREATE (m)-[:MODULE_CONTAINS_BB]->(b)",
        { containerPath, id: bbId },
      );
    } else {
      await this.db.query(
        "MATCH (bc:BoundedContext), (b:BuildingBlock) WHERE bc.name = $containerPath AND b.id = $id CREATE (bc)-[:BC_CONTAINS_BB]->(b)",
        { containerPath, id: bbId },
      );
    }
  }

  private async linkBuildingBlockToCodeType(bbId: string, typeId: string): Promise<void> {
    await this.db.query(
      "MATCH (b:BuildingBlock), (t:CodeType) WHERE b.id = $bbId AND t.id = $typeId CREATE (b)-[:BB_REPRESENTED_BY_CODE_TYPE]->(t)",
      { bbId, typeId },
    );
  }

  private async linkCodeTypeToCodeNamespace(typeId: string, nsFullName: string): Promise<void> {
    await this.db.query(
      "MATCH (t:CodeType), (n:CodeNamespace) WHERE t.id = $typeId AND n.fullName = $nsFullName CREATE (t)-[:CODE_TYPE_IN_CODE_NAMESPACE]->(n)",
      { typeId, nsFullName },
    );
  }
}

function extractMethodNameFromBehaviorId(id: string): string {
  const idx = id.lastIndexOf(":");
  return idx === -1 ? id : id.substring(idx + 1);
}

function buildTree(
  boundedContexts: BoundedContext[],
  modules: Module[],
  buildingBlocks: Array<BuildingBlock & { containerPath: string }>,
  behaviors: Array<{ buildingBlockId: string; id: string; name: string; actor: string }>,
): DomainModelTree {
  const modulesByParent = groupModulesByParent(modules);
  const behaviorsByBb = groupBehaviorsByBb(behaviors);
  const bbByContainer = groupBbByContainer(buildingBlocks, behaviorsByBb);

  const tree: BoundedContextBranch<BuildingBlockBranch>[] = boundedContexts.map((bc) => ({
    name: bc.name,
    modules: buildModuleSubtree(bc.name, modulesByParent, bbByContainer),
    buildingBlocks: bbByContainer.get(bc.name) ?? [],
  }));

  return { boundedContexts: tree };
}

function groupModulesByParent(modules: Module[]): Map<string, Module[]> {
  const map = new Map<string, Module[]>();
  for (const mod of modules) {
    const parentPath = parentPathOf(mod);
    const list = map.get(parentPath) ?? [];
    list.push(mod);
    map.set(parentPath, list);
  }
  return map;
}

function groupBbByContainer(
  blocks: Array<BuildingBlock & { containerPath: string }>,
  behaviorsByBb: Map<string, Behavior[]>,
): Map<string, BuildingBlockBranch[]> {
  const map = new Map<string, BuildingBlockBranch[]>();
  for (const bb of blocks) {
    const list = map.get(bb.containerPath) ?? [];
    list.push({
      id: bb.id,
      name: bb.name,
      type: bb.type,
      behaviors: behaviorsByBb.get(bb.id) ?? [],
    });
    map.set(bb.containerPath, list);
  }
  return map;
}

function groupBehaviorsByBb(
  behaviors: Array<{ buildingBlockId: string; id: string; name: string; actor: string }>,
): Map<string, Behavior[]> {
  const map = new Map<string, Behavior[]>();
  for (const row of behaviors) {
    const list = map.get(row.buildingBlockId) ?? [];
    list.push({ id: row.id, name: row.name, actor: row.actor === "" ? null : row.actor });
    map.set(row.buildingBlockId, list);
  }
  return map;
}

function buildModuleSubtree(
  parentPath: string,
  modulesByParent: Map<string, Module[]>,
  bbByContainer: Map<string, BuildingBlockBranch[]>,
): ModuleBranch<BuildingBlockBranch>[] {
  const children = modulesByParent.get(parentPath) ?? [];
  return children.map((mod) => ({
    name: mod.name,
    fullPath: mod.fullPath,
    modules: buildModuleSubtree(mod.fullPath, modulesByParent, bbByContainer),
    buildingBlocks: bbByContainer.get(mod.fullPath) ?? [],
  }));
}
