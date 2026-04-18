export interface TypeHeader {
  typeId: string;
  typeName: string;
  filePath: string;
  baseTypeNames: string[];
  interfaceTypeNames: string[];
}

export interface InheritanceMap {
  byTypeId: Map<string, TypeHeader>;
  byTypeName: Map<string, TypeHeader[]>;
}
