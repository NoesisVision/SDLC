export interface Behavior {
  id: string;
  name: string;
}

export interface Property {
  name: string;
  type: string | null;
}

export interface BuildingBlock {
  id: string;
  name: string;
  type: string;
  behaviors: Behavior[];
  properties: Property[];
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
