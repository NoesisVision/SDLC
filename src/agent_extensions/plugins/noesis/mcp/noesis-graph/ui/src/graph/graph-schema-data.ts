export interface PropertySchema {
  name: string;
  type: string;
  isPrimaryKey: boolean;
}

export interface NodeTableSchema {
  name: string;
  properties: PropertySchema[];
}

export interface RelTableSchema {
  name: string;
  from: string;
  to: string;
  properties: PropertySchema[];
}

export interface GraphSchemaData {
  nodeTables: NodeTableSchema[];
  relTables: RelTableSchema[];
}
