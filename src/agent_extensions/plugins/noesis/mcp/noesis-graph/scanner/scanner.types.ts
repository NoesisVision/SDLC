export const DDD_ANNOTATIONS = [
  "DddAggregate",
  "DddApplicationService",
  "DddBoundedContext",
  "DddDomainEvent",
  "DddDomainService",
  "DddEntity",
  "DddFactory",
  "DddRepository",
  "DddValueObject",
] as const;

export type DddAnnotation = (typeof DDD_ANNOTATIONS)[number];

export function annotationToBlockType(annotation: DddAnnotation): string {
  return annotation.replace(/^Ddd/, "");
}

export interface NoesisConfig {
  namespacePartsToSkip: string[];
  namespacesToExclude: string[];
}

export interface BoundedContextNode {
  name: string;
  fullPath: string;
}

export interface ModuleNode {
  name: string;
  fullPath: string;
  parentPath: string;
}

export interface BuildingBlockNode {
  name: string;
  type: string;
  annotation: string;
  namespace: string;
  filePath: string;
  containerPath: string;
}

export interface ModelTree {
  boundedContexts: BoundedContextTreeNode[];
}

export interface BoundedContextTreeNode {
  name: string;
  fullPath: string;
  modules: ModuleTreeNode[];
  buildingBlocks: BuildingBlockLeaf[];
}

export interface ModuleTreeNode {
  name: string;
  fullPath: string;
  modules: ModuleTreeNode[];
  buildingBlocks: BuildingBlockLeaf[];
}

export interface BuildingBlockLeaf {
  name: string;
  type: string;
  annotation: string;
  filePath: string;
}
