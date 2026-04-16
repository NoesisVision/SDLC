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

export const LSP_KIND = {
  NAMESPACE: 3,
  CLASS: 5,
  METHOD: 6,
  PROPERTY: 7,
  FIELD: 8,
  CONSTRUCTOR: 9,
  ENUM: 10,
  INTERFACE: 11,
  STRUCT: 23,
} as const;

export const TYPE_KINDS = [
  LSP_KIND.CLASS,
  LSP_KIND.STRUCT,
  LSP_KIND.INTERFACE,
  LSP_KIND.ENUM,
] as const;

export interface SerenaSymbol {
  name: string;
  name_path: string;
  kind: number;
  relative_path: string;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  info?: string;
  body?: string;
  children?: SerenaSymbol[];
}

export interface SerenaReference {
  referencing_symbol: SerenaSymbol;
  snippet?: string;
}
