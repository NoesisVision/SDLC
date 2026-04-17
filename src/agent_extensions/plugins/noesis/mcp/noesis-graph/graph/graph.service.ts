import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";

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

@Injectable()
export class GraphService {
  private readonly logger = new Logger(GraphService.name);

  constructor(private readonly db: DatabaseService) {}

  async getSchema(): Promise<GraphSchema> {
    const conn = this.db.getConnection();

    const tablesResult = await conn.query("CALL show_tables() RETURN *");
    const tables = asRows(tablesResult) as Array<{
      name: string;
      type: string;
      comment: string;
    }>;

    const nodeTables: NodeTableSchema[] = [];
    const relTables: RelTableSchema[] = [];

    for (const table of tables) {
      const propsResult = await conn.query(
        `CALL table_info('${table.name}') RETURN *`,
      );
      const props = asRows(propsResult) as Array<{
        property_id: number;
        name: string;
        type: string;
        primary_key: boolean;
      }>;

      const properties: PropertySchema[] = props.map((p) => ({
        name: p.name,
        type: p.type,
        isPrimaryKey: p.primary_key ?? false,
      }));

      if (table.type === "NODE") {
        nodeTables.push({ name: table.name, properties });
      } else if (table.type === "REL") {
        const connResult = await conn.query(
          `CALL show_connection('${table.name}') RETURN *`,
        );
        const connections = asRows(connResult) as Array<Record<string, string>>;

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

    this.logger.log(
      `Schema: ${nodeTables.length} node tables, ${relTables.length} rel tables`,
    );
    return { nodeTables, relTables };
  }
}

function asRows(result: unknown): unknown[] {
  if (Array.isArray(result)) return result[0].getAllSync();
  return (result as { getAllSync(): unknown[] }).getAllSync();
}
