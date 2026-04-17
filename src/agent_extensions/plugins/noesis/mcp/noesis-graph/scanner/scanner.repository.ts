import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import type {
  BoundedContextNode,
  ModuleNode,
  BuildingBlockNode,
  ModelTree,
  BoundedContextTreeNode,
  ModuleTreeNode,
  BuildingBlockLeaf,
} from "./scanner.types.js";

const SCHEMA_STATEMENTS = [
  "CREATE NODE TABLE IF NOT EXISTS BoundedContext(name STRING, fullPath STRING, PRIMARY KEY(fullPath))",
  "CREATE NODE TABLE IF NOT EXISTS Module(name STRING, fullPath STRING, PRIMARY KEY(fullPath))",
  "CREATE NODE TABLE IF NOT EXISTS BuildingBlock(id STRING, name STRING, type STRING, annotation STRING, namespace STRING, filePath STRING, PRIMARY KEY(id))",
  "CREATE REL TABLE IF NOT EXISTS BC_CONTAINS_MODULE(FROM BoundedContext TO Module)",
  "CREATE REL TABLE IF NOT EXISTS MODULE_CONTAINS_MODULE(FROM Module TO Module)",
  "CREATE REL TABLE IF NOT EXISTS BC_CONTAINS_BB(FROM BoundedContext TO BuildingBlock)",
  "CREATE REL TABLE IF NOT EXISTS MODULE_CONTAINS_BB(FROM Module TO BuildingBlock)",
];

const CLEAR_STATEMENTS = [
  "MATCH (n:BuildingBlock) DETACH DELETE n",
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

  async insertBoundedContext(bc: BoundedContextNode): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "CREATE (b:BoundedContext {name: $name, fullPath: $fullPath})",
    );
    await conn.execute(stmt, { name: bc.name, fullPath: bc.fullPath });
  }

  async insertModule(mod: ModuleNode): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "CREATE (m:Module {name: $name, fullPath: $fullPath})",
    );
    await conn.execute(stmt, { name: mod.name, fullPath: mod.fullPath });
    await this.linkModuleToParent(mod);
  }

  async insertBuildingBlock(bb: BuildingBlockNode): Promise<void> {
    const conn = this.db.getConnection();
    const id = `${bb.filePath}:${bb.name}`;
    const stmt = await conn.prepare(
      "CREATE (b:BuildingBlock {id: $id, name: $name, type: $type, annotation: $annotation, namespace: $ns, filePath: $filePath})",
    );
    await conn.execute(stmt, {
      id,
      name: bb.name,
      type: bb.type,
      annotation: bb.annotation,
      ns: bb.namespace,
      filePath: bb.filePath,
    });
    await this.linkBuildingBlockToContainer(bb, id);
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

    const bbResult = await conn.query(
      "MATCH (b:BuildingBlock) RETURN b.name AS name, b.type AS type, b.annotation AS annotation, b.namespace AS namespace, b.filePath AS filePath ORDER BY b.name",
    );
    const buildingBlocks = bbResult instanceof Array ? bbResult[0].getAllSync() : bbResult.getAllSync();
    const typedBlocks = buildingBlocks as Array<{
      name: string;
      type: string;
      annotation: string;
      namespace: string;
      filePath: string;
    }>;

    return buildTree(boundedContexts, modules, typedBlocks);
  }

  private async linkModuleToParent(mod: ModuleNode): Promise<void> {
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

  private async linkBuildingBlockToContainer(bb: BuildingBlockNode, id: string): Promise<void> {
    const conn = this.db.getConnection();

    const modStmt = await conn.prepare(
      "MATCH (m:Module), (b:BuildingBlock) WHERE m.fullPath = $containerPath AND b.id = $id CREATE (m)-[:MODULE_CONTAINS_BB]->(b)",
    );
    const modResult = await conn.execute(modStmt, {
      containerPath: bb.containerPath,
      id,
    });

    if (asArray(modResult).getNumTuples() === 0) {
      const bcStmt = await conn.prepare(
        "MATCH (bc:BoundedContext), (b:BuildingBlock) WHERE bc.fullPath = $containerPath AND b.id = $id CREATE (bc)-[:BC_CONTAINS_BB]->(b)",
      );
      await conn.execute(bcStmt, {
        containerPath: bb.containerPath,
        id,
      });
    }
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
    name: string;
    type: string;
    annotation: string;
    namespace: string;
    filePath: string;
  }>,
): ModelTree {
  const modulesByParent = groupModulesByParent(modules);
  const bbByContainer = groupBbByContainer(buildingBlocks, modules, boundedContexts);

  const tree: BoundedContextTreeNode[] = boundedContexts.map((bc) => ({
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
    name: string;
    type: string;
    annotation: string;
    namespace: string;
    filePath: string;
  }>,
  modules: Array<{ name: string; fullPath: string }>,
  boundedContexts: Array<{ name: string; fullPath: string }>,
): Map<string, BuildingBlockLeaf[]> {
  const allPaths = [
    ...modules.map((m) => m.fullPath),
    ...boundedContexts.map((bc) => bc.fullPath),
  ].sort((a, b) => b.length - a.length);

  const map = new Map<string, BuildingBlockLeaf[]>();
  for (const bb of blocks) {
    const container = allPaths.find((p) => bb.namespace.startsWith(p)) ?? "";
    const leaf: BuildingBlockLeaf = {
      name: bb.name,
      type: bb.type,
      annotation: bb.annotation,
      filePath: bb.filePath,
    };
    const list = map.get(container) ?? [];
    list.push(leaf);
    map.set(container, list);
  }
  return map;
}

function buildModuleSubtree(
  parentPath: string,
  modulesByParent: Map<string, Array<{ name: string; fullPath: string }>>,
  bbByContainer: Map<string, BuildingBlockLeaf[]>,
): ModuleTreeNode[] {
  const children = modulesByParent.get(parentPath) ?? [];
  return children.map((mod) => ({
    name: mod.name,
    fullPath: mod.fullPath,
    modules: buildModuleSubtree(mod.fullPath, modulesByParent, bbByContainer),
    buildingBlocks: bbByContainer.get(mod.fullPath) ?? [],
  }));
}
