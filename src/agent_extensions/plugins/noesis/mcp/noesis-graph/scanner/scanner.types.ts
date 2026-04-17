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

export interface BoundedContext {
  name: string;
  fullPath: string;
}

export interface Module {
  name: string;
  fullPath: string;
  parentPath: string;
}

export interface BuildingBlock {
  id: string;
  name: string;
  type: string;
  annotation: string;
}

export interface CodeStructure {
  name: string;
}

export interface CSharpNamespace extends CodeStructure {
  fullName: string;
}

export interface CSharpType extends CodeStructure {
  id: string;
  fullName: string;
  filePath: string;
}

export interface ModelTree {
  boundedContexts: BoundedContextBranch[];
}

export interface BoundedContextBranch {
  name: string;
  fullPath: string;
  modules: ModuleBranch[];
  buildingBlocks: BuildingBlockLeaf[];
}

export interface ModuleBranch {
  name: string;
  fullPath: string;
  modules: ModuleBranch[];
  buildingBlocks: BuildingBlockLeaf[];
}

export interface BuildingBlockLeaf {
  name: string;
  type: string;
  annotation: string;
  filePath: string;
}
