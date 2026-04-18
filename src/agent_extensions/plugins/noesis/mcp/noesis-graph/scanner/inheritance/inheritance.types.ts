export type TypeKind = "class" | "struct" | "record" | "interface";

export interface TypeHeader {
  typeId: string;
  typeName: string;
  filePath: string;
  kind: TypeKind;
  baseTypeNames: string[];
  interfaceTypeNames: string[];
}

export interface InheritanceMap {
  byTypeId: Map<string, TypeHeader>;
  byTypeName: Map<string, TypeHeader[]>;
}
