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
