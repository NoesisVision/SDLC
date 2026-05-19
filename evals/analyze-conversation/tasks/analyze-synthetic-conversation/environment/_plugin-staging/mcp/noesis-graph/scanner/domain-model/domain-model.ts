export interface BoundedContext {
  name: string;
}

export interface Module {
  name: string;
  fullPath: string;
}

export interface BuildingBlock {
  id: string;
  name: string;
  type: string;
}

export interface Behavior {
  id: string;
  name: string;
  actor: string | null;
}

export interface BuildingBlockBranch extends BuildingBlock {
  behaviors: Behavior[];
}

export interface DomainModelTree<Leaf extends BuildingBlock = BuildingBlockBranch> {
  boundedContexts: BoundedContextBranch<Leaf>[];
}

export interface BoundedContextBranch<Leaf extends BuildingBlock = BuildingBlock>
  extends BoundedContext {
  modules: ModuleBranch<Leaf>[];
  buildingBlocks: Leaf[];
}

export interface ModuleBranch<Leaf extends BuildingBlock = BuildingBlock>
  extends Module {
  modules: ModuleBranch<Leaf>[];
  buildingBlocks: Leaf[];
}

export function parentPathOf(mod: Module): string {
  const idx = mod.fullPath.lastIndexOf(".");
  return idx < 0 ? "" : mod.fullPath.substring(0, idx);
}
