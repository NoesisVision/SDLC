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
}

export interface BuildingBlockBranch extends BuildingBlock {
  behaviors: Behavior[];
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

export interface BuildingBlockWithCode extends BuildingBlock {
  codeStructure: CodeStructure;
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
