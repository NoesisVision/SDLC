import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import type {
  BoundedContext,
  Module,
  BuildingBlock,
  CSharpNamespace,
  CSharpType,
  ModelTree,
  BoundedContextBranch,
  ModuleBranch,
  BuildingBlockLeaf,
} from "./scanner.types.js";

const SCHEMA_STATEMENTS = [
  "CREATE NODE TABLE IF NOT EXISTS BoundedContext(name STRING, fullPath STRING, PRIMARY KEY(fullPath))",
  "CREATE NODE TABLE IF NOT EXISTS Module(name STRING, fullPath STRING, PRIMARY KEY(fullPath))",
  "CREATE NODE TABLE IF NOT EXISTS BuildingBlock(id STRING, name STRING, type STRING, annotation STRING, PRIMARY KEY(id))",
  "CREATE NODE TABLE IF NOT EXISTS CSharpNamespace(name STRING, fullName STRING, PRIMARY KEY(fullName))",
  "CREATE NODE TABLE IF NOT EXISTS CSharpType(id STRING, name STRING, fullName STRING, filePath STRING, PRIMARY KEY(id))",
  "CREATE REL TABLE IF NOT EXISTS BC_CONTAINS_MODULE(FROM BoundedContext TO Module)",
  "CREATE REL TABLE IF NOT EXISTS MODULE_CONTAINS_MODULE(FROM Module TO Module)",
  "CREATE REL TABLE IF NOT EXISTS BC_CONTAINS_BB(FROM BoundedContext TO BuildingBlock)",
  "CREATE REL TABLE IF NOT EXISTS MODULE_CONTAINS_BB(FROM Module TO BuildingBlock)",
  "CREATE REL TABLE IF NOT EXISTS BC_REPRESENTED_BY_CSHARP_NAMESPACE(FROM BoundedContext TO CSharpNamespace)",
  "CREATE REL TABLE IF NOT EXISTS MODULE_REPRESENTED_BY_CSHARP_NAMESPACE(FROM Module TO CSharpNamespace)",
  "CREATE REL TABLE IF NOT EXISTS BB_REPRESENTED_BY_CSHARP_TYPE(FROM BuildingBlock TO CSharpType)",
  "CREATE REL TABLE IF NOT EXISTS CSHARP_TYPE_IN_CSHARP_NAMESPACE(FROM CSharpType TO CSharpNamespace)",
];

const CLEAR_STATEMENTS = [
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
    const stmt = await conn.prepare(
      "CREATE (b:BoundedContext {name: $name, fullPath: $fullPath})",
    );
    await conn.execute(stmt, { name: bc.name, fullPath: bc.fullPath });
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
      "CREATE (b:BuildingBlock {id: $id, name: $name, type: $type, annotation: $annotation})",
    );
    await conn.execute(stmt, {
      id: bb.id,
      name: bb.name,
      type: bb.type,
      annotation: bb.annotation,
    });
    await this.linkBuildingBlockToContainer(bb.id, containerPath);
    await this.linkBuildingBlockToCSharpType(bb.id, codeTypeId);
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

  async linkBoundedContextToCSharpNamespace(bcFullPath: string, nsFullName: string): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "MATCH (bc:BoundedContext), (n:CSharpNamespace) WHERE bc.fullPath = $bcFullPath AND n.fullName = $nsFullName CREATE (bc)-[:BC_REPRESENTED_BY_CSHARP_NAMESPACE]->(n)",
    );
    await conn.execute(stmt, { bcFullPath, nsFullName });
  }

  async linkModuleToCSharpNamespace(modFullPath: string, nsFullName: string): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "MATCH (m:Module), (n:CSharpNamespace) WHERE m.fullPath = $modFullPath AND n.fullName = $nsFullName CREATE (m)-[:MODULE_REPRESENTED_BY_CSHARP_NAMESPACE]->(n)",
    );
    await conn.execute(stmt, { modFullPath, nsFullName });
  }

  async getModelTree(): Promise<ModelTree> {
    const conn = this.db.getConnection();

    const bcResult = await conn.query(
      "MATCH (b:BoundedContext) RETURN b.name AS name, b.fullPath AS fullPath ORDER BY b.name",
    );
    const boundedContexts = asArray(bcResult).getAllSync() as Array<{
      name: string;
      fullPath: string;
    }>;

    const modResult = await conn.query(
      "MATCH (m:Module) RETURN m.name AS name, m.fullPath AS fullPath ORDER BY m.name",
    );
    const modules = asArray(modResult).getAllSync() as Array<{
      name: string;
      fullPath: string;
    }>;

    const bbInModulesResult = await conn.query(
      "MATCH (m:Module)-[:MODULE_CONTAINS_BB]->(b:BuildingBlock)-[:BB_REPRESENTED_BY_CSHARP_TYPE]->(t:CSharpType) RETURN m.fullPath AS containerPath, b.name AS name, b.type AS type, b.annotation AS annotation, t.filePath AS filePath ORDER BY b.name",
    );
    const bbInModules = asArray(bbInModulesResult).getAllSync() as Array<{
      containerPath: string;
      name: string;
      type: string;
      annotation: string;
      filePath: string;
    }>;

    const bbInBcsResult = await conn.query(
      "MATCH (bc:BoundedContext)-[:BC_CONTAINS_BB]->(b:BuildingBlock)-[:BB_REPRESENTED_BY_CSHARP_TYPE]->(t:CSharpType) RETURN bc.fullPath AS containerPath, b.name AS name, b.type AS type, b.annotation AS annotation, t.filePath AS filePath ORDER BY b.name",
    );
    const bbInBcs = asArray(bbInBcsResult).getAllSync() as Array<{
      containerPath: string;
      name: string;
      type: string;
      annotation: string;
      filePath: string;
    }>;

    return buildTree(boundedContexts, modules, [...bbInModules, ...bbInBcs]);
  }

  private async linkModuleToParent(mod: Module): Promise<void> {
    const conn = this.db.getConnection();

    const bcStmt = await conn.prepare(
      "MATCH (bc:BoundedContext), (m:Module) WHERE bc.fullPath = $parentPath AND m.fullPath = $childPath CREATE (bc)-[:BC_CONTAINS_MODULE]->(m)",
    );
    const bcResult = await conn.execute(bcStmt, {
      parentPath: mod.parentPath,
      childPath: mod.fullPath,
    });

    if (asArray(bcResult).getNumTuples() === 0) {
      const modStmt = await conn.prepare(
        "MATCH (parent:Module), (child:Module) WHERE parent.fullPath = $parentPath AND child.fullPath = $childPath CREATE (parent)-[:MODULE_CONTAINS_MODULE]->(child)",
      );
      await conn.execute(modStmt, {
        parentPath: mod.parentPath,
        childPath: mod.fullPath,
      });
    }
  }

  private async linkBuildingBlockToContainer(bbId: string, containerPath: string): Promise<void> {
    const conn = this.db.getConnection();

    const modStmt = await conn.prepare(
      "MATCH (m:Module), (b:BuildingBlock) WHERE m.fullPath = $containerPath AND b.id = $id CREATE (m)-[:MODULE_CONTAINS_BB]->(b)",
    );
    const modResult = await conn.execute(modStmt, { containerPath, id: bbId });

    if (asArray(modResult).getNumTuples() === 0) {
      const bcStmt = await conn.prepare(
        "MATCH (bc:BoundedContext), (b:BuildingBlock) WHERE bc.fullPath = $containerPath AND b.id = $id CREATE (bc)-[:BC_CONTAINS_BB]->(b)",
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

function buildTree(
  boundedContexts: Array<{ name: string; fullPath: string }>,
  modules: Array<{ name: string; fullPath: string }>,
  buildingBlocks: Array<{
    containerPath: string;
    name: string;
    type: string;
    annotation: string;
    filePath: string;
  }>,
): ModelTree {
  const modulesByParent = groupModulesByParent(modules);
  const bbByContainer = groupBbByContainer(buildingBlocks);

  const tree: BoundedContextBranch[] = boundedContexts.map((bc) => ({
    name: bc.name,
    fullPath: bc.fullPath,
    modules: buildModuleSubtree(bc.fullPath, modulesByParent, bbByContainer),
    buildingBlocks: bbByContainer.get(bc.fullPath) ?? [],
  }));

  return { boundedContexts: tree };
}

function groupModulesByParent(
  modules: Array<{ name: string; fullPath: string }>,
): Map<string, Array<{ name: string; fullPath: string }>> {
  const map = new Map<string, Array<{ name: string; fullPath: string }>>();
  for (const mod of modules) {
    const parentPath = mod.fullPath.substring(0, mod.fullPath.lastIndexOf("."));
    const list = map.get(parentPath) ?? [];
    list.push(mod);
    map.set(parentPath, list);
  }
  return map;
}

function groupBbByContainer(
  blocks: Array<{
    containerPath: string;
    name: string;
    type: string;
    annotation: string;
    filePath: string;
  }>,
): Map<string, BuildingBlockLeaf[]> {
  const map = new Map<string, BuildingBlockLeaf[]>();
  for (const bb of blocks) {
    const leaf: BuildingBlockLeaf = {
      name: bb.name,
      type: bb.type,
      annotation: bb.annotation,
      filePath: bb.filePath,
    };
    const list = map.get(bb.containerPath) ?? [];
    list.push(leaf);
    map.set(bb.containerPath, list);
  }
  return map;
}

function buildModuleSubtree(
  parentPath: string,
  modulesByParent: Map<string, Array<{ name: string; fullPath: string }>>,
  bbByContainer: Map<string, BuildingBlockLeaf[]>,
): ModuleBranch[] {
  const children = modulesByParent.get(parentPath) ?? [];
  return children.map((mod) => ({
    name: mod.name,
    fullPath: mod.fullPath,
    modules: buildModuleSubtree(mod.fullPath, modulesByParent, bbByContainer),
    buildingBlocks: bbByContainer.get(mod.fullPath) ?? [],
  }));
}
