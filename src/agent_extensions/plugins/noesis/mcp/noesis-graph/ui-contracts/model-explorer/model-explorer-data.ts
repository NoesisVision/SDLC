export interface Behavior {
  id: string;
  name: string;
}

export interface BuildingBlock {
  id: string;
  name: string;
  type: string;
  behaviors: Behavior[];
}

export interface ModuleBranch {
  name: string;
  fullPath: string;
  modules: ModuleBranch[];
  buildingBlocks: BuildingBlock[];
}

export interface BoundedContextBranch {
  name: string;
  modules: ModuleBranch[];
  buildingBlocks: BuildingBlock[];
}

export interface DomainModelTree {
  boundedContexts: BoundedContextBranch[];
}

export interface ModelExplorerData {
  tree: DomainModelTree;
}
