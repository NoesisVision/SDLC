import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import {
  parentPathOf,
  type BoundedContext,
  type Module,
  type Behavior,
  type BuildingBlock,
  type BuildingBlockBranch,
  type CSharpNamespace,
  type CSharpType,
  type DomainModelTree,
  type BoundedContextBranch,
  type ModuleBranch,
} from "./scanner.types.js";

const SCHEMA_STATEMENTS = [
  "CREATE NODE TABLE IF NOT EXISTS BoundedContext(name STRING, PRIMARY KEY(name))",
  "CREATE NODE TABLE IF NOT EXISTS Module(name STRING, fullPath STRING, PRIMARY KEY(fullPath))",
  "CREATE NODE TABLE IF NOT EXISTS BuildingBlock(id STRING, name STRING, type STRING, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS Behavior(id STRING, name STRING, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS CSharpNamespace(name STRING, fullName STRING, PRIMARY KEY(fullName))",
  "CREATE NODE TABLE IF NOT EXISTS CSharpType(id STRING, name STRING, fullName STRING, filePath STRING, PRIMARY KEY(id))",
  "CREATE REL TABLE IF NOT EXISTS BC_CONTAINS_MODULE(FROM BoundedContext TO Module)",
  "CREATE REL TABLE IF NOT EXISTS MODULE_CONTAINS_MODULE(FROM Module TO Module)",
  "CREATE REL TABLE IF NOT EXISTS BC_CONTAINS_BB(FROM BoundedContext TO BuildingBlock)",
  "CREATE REL TABLE IF NOT EXISTS MODULE_CONTAINS_BB(FROM Module TO BuildingBlock)",
  "CREATE REL TABLE IF NOT EXISTS BB_CONTAINS_BEHAVIOR(FROM BuildingBlock TO Behavior)",
  "CREATE REL TABLE IF NOT EXISTS BC_REPRESENTED_BY_CSHARP_NAMESPACE(FROM BoundedContext TO CSharpNamespace)",
  "CREATE REL TABLE IF NOT EXISTS MODULE_REPRESENTED_BY_CSHARP_NAMESPACE(FROM Module TO CSharpNamespace)",
  "CREATE REL TABLE IF NOT EXISTS BB_REPRESENTED_BY_CSHARP_TYPE(FROM BuildingBlock TO CSharpType)",
  "CREATE REL TABLE IF NOT EXISTS CSHARP_TYPE_IN_CSHARP_NAMESPACE(FROM CSharpType TO CSharpNamespace)",
];

const CLEAR_STATEMENTS = [
  "MATCH (n:Behavior) DETACH DELETE n",
  "MATCH (n:BuildingBlock) DETACH DELETE n",
  "MATCH (n:CSharpType) DETACH DELETE n",
  "MATCH (n:CSharpNamespace) DETACH DELETE n",
  "MATCH (n:Module) DETACH DELETE n",
  "MATCH (n:BoundedContext) DETACH DELETE n",
];

@Injectable()
export class ScannerRepository {
  private readonly logger = new Logger(ScannerRepository.name);

  constructor(private readonly db: DatabaseService) {}

  async initSchema(): Promise<void> {
    const conn = this.db.getConnection();
    for (const stmt of SCHEMA_STATEMENTS) {
      await conn.query(stmt);
    }
    this.logger.log("Model schema initialized");
  }

  async clearModel(): Promise<void> {
    const conn = this.db.getConnection();
    for (const stmt of CLEAR_STATEMENTS) {
      await conn.query(stmt);
    }
  }

  async insertBoundedContext(bc: BoundedContext): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare("CREATE (b:BoundedContext {name: $name})");
    await conn.execute(stmt, { name: bc.name });
  }

  async insertModule(mod: Module): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "CREATE (m:Module {name: $name, fullPath: $fullPath})",
    );
    await conn.execute(stmt, { name: mod.name, fullPath: mod.fullPath });
    await this.linkModuleToParent(mod);
  }

  async insertBuildingBlock(bb: BuildingBlock, containerPath: string, codeTypeId: string): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "CREATE (b:BuildingBlock {id: $id, name: $name, type: $type})",
    );
    await conn.execute(stmt, { id: bb.id, name: bb.name, type: bb.type });
    await this.linkBuildingBlockToContainer(bb.id, containerPath);
    await this.linkBuildingBlockToCSharpType(bb.id, codeTypeId);
  }

  async insertBehavior(behavior: Behavior, buildingBlockId: string): Promise<void> {
    const conn = this.db.getConnection();
    const createStmt = await conn.prepare(
      "CREATE (x:Behavior {id: $id, name: $name})",
    );
    await conn.execute(createStmt, { id: behavior.id, name: behavior.name });
    const linkStmt = await conn.prepare(
      "MATCH (b:BuildingBlock), (x:Behavior) WHERE b.id = $bbId AND x.id = $behaviorId CREATE (b)-[:BB_CONTAINS_BEHAVIOR]->(x)",
    );
    await conn.execute(linkStmt, { bbId: buildingBlockId, behaviorId: behavior.id });
  }

  async insertCSharpNamespace(ns: CSharpNamespace): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "CREATE (n:CSharpNamespace {name: $name, fullName: $fullName})",
    );
    await conn.execute(stmt, { name: ns.name, fullName: ns.fullName });
  }

  async insertCSharpType(t: CSharpType, namespaceFullName: string): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "CREATE (t:CSharpType {id: $id, name: $name, fullName: $fullName, filePath: $filePath})",
    );
    await conn.execute(stmt, {
      id: t.id,
      name: t.name,
      fullName: t.fullName,
      filePath: t.filePath,
    });
    await this.linkCSharpTypeToCSharpNamespace(t.id, namespaceFullName);
  }

  async linkBoundedContextToCSharpNamespace(bcName: string, nsFullName: string): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "MATCH (bc:BoundedContext), (n:CSharpNamespace) WHERE bc.name = $bcName AND n.fullName = $nsFullName CREATE (bc)-[:BC_REPRESENTED_BY_CSHARP_NAMESPACE]->(n)",
    );
    await conn.execute(stmt, { bcName, nsFullName });
  }

  async linkModuleToCSharpNamespace(modFullPath: string, nsFullName: string): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "MATCH (m:Module), (n:CSharpNamespace) WHERE m.fullPath = $modFullPath AND n.fullName = $nsFullName CREATE (m)-[:MODULE_REPRESENTED_BY_CSHARP_NAMESPACE]->(n)",
    );
    await conn.execute(stmt, { modFullPath, nsFullName });
  }

  async getBehaviorsWithLocations(): Promise<
    Array<{ id: string; filePath: string; typeName: string; methodName: string }>
  > {
    const conn = this.db.getConnection();
    const result = await conn.query(
      "MATCH (b:BuildingBlock)-[:BB_REPRESENTED_BY_CSHARP_TYPE]->(t:CSharpType), " +
        "(b)-[:BB_CONTAINS_BEHAVIOR]->(x:Behavior) " +
        "RETURN x.id AS id, t.filePath AS filePath, t.name AS typeName " +
        "ORDER BY x.id",
    );
    const rows = asArray(result).getAllSync() as Array<{
      id: string;
      filePath: string;
      typeName: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      filePath: r.filePath,
      typeName: r.typeName,
      methodName: extractMethodNameFromBehaviorId(r.id),
    }));
  }

  async getDomainModel(): Promise<DomainModelTree> {
    const conn = this.db.getConnection();

    const bcResult = await conn.query(
      "MATCH (b:BoundedContext) RETURN b.name AS name ORDER BY b.name",
    );
    const boundedContexts = asArray(bcResult).getAllSync() as BoundedContext[];

    const modResult = await conn.query(
      "MATCH (m:Module) RETURN m.name AS name, m.fullPath AS fullPath ORDER BY m.name",
    );
    const modules = asArray(modResult).getAllSync() as Module[];

    const bbInModulesResult = await conn.query(
      "MATCH (m:Module)-[:MODULE_CONTAINS_BB]->(b:BuildingBlock) RETURN m.fullPath AS containerPath, b.id AS id, b.name AS name, b.type AS type ORDER BY b.name",
    );
    const bbInModules = asArray(bbInModulesResult).getAllSync() as Array<
      BuildingBlock & { containerPath: string }
    >;

    const bbInBcsResult = await conn.query(
      "MATCH (bc:BoundedContext)-[:BC_CONTAINS_BB]->(b:BuildingBlock) RETURN bc.name AS containerPath, b.id AS id, b.name AS name, b.type AS type ORDER BY b.name",
    );
    const bbInBcs = asArray(bbInBcsResult).getAllSync() as Array<
      BuildingBlock & { containerPath: string }
    >;

    const behaviorsResult = await conn.query(
      "MATCH (b:BuildingBlock)-[:BB_CONTAINS_BEHAVIOR]->(x:Behavior) RETURN b.id AS buildingBlockId, x.id AS id, x.name AS name ORDER BY x.name",
    );
    const behaviorRows = asArray(behaviorsResult).getAllSync() as Array<
      Behavior & { buildingBlockId: string }
    >;

    return buildTree(boundedContexts, modules, [...bbInModules, ...bbInBcs], behaviorRows);
  }

  private async linkModuleToParent(mod: Module): Promise<void> {
    const conn = this.db.getConnection();
    const parentPath = parentPathOf(mod);

    const parentParts = parentPath.split(".");
    if (parentParts.length === 1) {
      const bcStmt = await conn.prepare(
        "MATCH (bc:BoundedContext), (m:Module) WHERE bc.name = $parentName AND m.fullPath = $childPath CREATE (bc)-[:BC_CONTAINS_MODULE]->(m)",
      );
      await conn.execute(bcStmt, { parentName: parentPath, childPath: mod.fullPath });
    } else {
      const modStmt = await conn.prepare(
        "MATCH (parent:Module), (child:Module) WHERE parent.fullPath = $parentPath AND child.fullPath = $childPath CREATE (parent)-[:MODULE_CONTAINS_MODULE]->(child)",
      );
      await conn.execute(modStmt, { parentPath, childPath: mod.fullPath });
    }
  }

  private async linkBuildingBlockToContainer(bbId: string, containerPath: string): Promise<void> {
    const conn = this.db.getConnection();

    if (containerPath.includes(".")) {
      const modStmt = await conn.prepare(
        "MATCH (m:Module), (b:BuildingBlock) WHERE m.fullPath = $containerPath AND b.id = $id CREATE (m)-[:MODULE_CONTAINS_BB]->(b)",
      );
      await conn.execute(modStmt, { containerPath, id: bbId });
    } else {
      const bcStmt = await conn.prepare(
        "MATCH (bc:BoundedContext), (b:BuildingBlock) WHERE bc.name = $containerPath AND b.id = $id CREATE (bc)-[:BC_CONTAINS_BB]->(b)",
      );
      await conn.execute(bcStmt, { containerPath, id: bbId });
    }
  }

  private async linkBuildingBlockToCSharpType(bbId: string, typeId: string): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "MATCH (b:BuildingBlock), (t:CSharpType) WHERE b.id = $bbId AND t.id = $typeId CREATE (b)-[:BB_REPRESENTED_BY_CSHARP_TYPE]->(t)",
    );
    await conn.execute(stmt, { bbId, typeId });
  }

  private async linkCSharpTypeToCSharpNamespace(typeId: string, nsFullName: string): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "MATCH (t:CSharpType), (n:CSharpNamespace) WHERE t.id = $typeId AND n.fullName = $nsFullName CREATE (t)-[:CSHARP_TYPE_IN_CSHARP_NAMESPACE]->(n)",
    );
    await conn.execute(stmt, { typeId, nsFullName });
  }
}

function asArray(result: unknown): { getNumTuples(): number; getAllSync(): unknown[] } {
  if (Array.isArray(result)) return result[0];
  return result as { getNumTuples(): number; getAllSync(): unknown[] };
}

function extractMethodNameFromBehaviorId(id: string): string {
  const idx = id.lastIndexOf(":");
  return idx === -1 ? id : id.substring(idx + 1);
}

function buildTree(
  boundedContexts: BoundedContext[],
  modules: Module[],
  buildingBlocks: Array<BuildingBlock & { containerPath: string }>,
  behaviors: Array<Behavior & { buildingBlockId: string }>,
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
  behaviors: Array<Behavior & { buildingBlockId: string }>,
): Map<string, Behavior[]> {
  const map = new Map<string, Behavior[]>();
  for (const row of behaviors) {
    const list = map.get(row.buildingBlockId) ?? [];
    list.push({ id: row.id, name: row.name });
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
