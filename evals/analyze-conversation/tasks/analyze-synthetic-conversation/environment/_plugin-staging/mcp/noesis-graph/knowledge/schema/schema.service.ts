import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { DatabaseService } from "../../database/database.service.js";

export interface NodeTableSchema {
  name: string;
  properties: PropertySchema[];
}

export interface PropertySchema {
  name: string;
  type: string;
  isPrimaryKey: boolean;
}

export interface RelTableSchema {
  name: string;
  from: string;
  to: string;
  properties: PropertySchema[];
}

export interface GraphSchema {
  nodeTables: NodeTableSchema[];
  relTables: RelTableSchema[];
}

const TableRowSchema = z.object({
  name: z.string(),
  type: z.string(),
  comment: z.string(),
});
type TableRow = z.infer<typeof TableRowSchema>;

const PropertyRowSchema = z.object({
  name: z.string(),
  type: z.string(),
  primary_key: z.boolean().nullable().optional(),
});
type PropertyRow = z.infer<typeof PropertyRowSchema>;

const ConnectionRowSchema = z.object({
  "source table name": z.string(),
  "destination table name": z.string(),
});
type ConnectionRow = z.infer<typeof ConnectionRowSchema>;

@Injectable()
export class SchemaService {
  constructor(private readonly db: DatabaseService) {}

  async getSchema(): Promise<GraphSchema> {
    const rawTables = await this.db.query<TableRow>(
      "CALL show_tables() RETURN *",
    );
    const tables = z.array(TableRowSchema).parse(rawTables);

    const nodeTables: NodeTableSchema[] = [];
    const relTables: RelTableSchema[] = [];

    for (const table of tables) {
      const rawProps = await this.db.query<PropertyRow>(
        `CALL table_info('${table.name}') RETURN *`,
      );
      const props = z.array(PropertyRowSchema).parse(rawProps);

      const properties: PropertySchema[] = props.map((p) => ({
        name: p.name,
        type: p.type,
        isPrimaryKey: p.primary_key ?? false,
      }));

      if (table.type === "NODE") {
        nodeTables.push({ name: table.name, properties });
      } else if (table.type === "REL") {
        const rawConnections = await this.db.query<ConnectionRow>(
          `CALL show_connection('${table.name}') RETURN *`,
        );
        const connections = z.array(ConnectionRowSchema).parse(rawConnections);

        for (const c of connections) {
          relTables.push({
            name: table.name,
            from: c["source table name"],
            to: c["destination table name"],
            properties,
          });
        }
      }
    }

    return { nodeTables, relTables };
  }
}
