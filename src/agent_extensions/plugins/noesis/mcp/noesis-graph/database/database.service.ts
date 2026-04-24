import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import lbug, { type LbugValue } from "lbug";
import { DATA_DIR } from "../config/config.module.js";

const { Database, Connection } = lbug;

type LbugDatabase = InstanceType<typeof Database>;
type LbugConnection = InstanceType<typeof Connection>;
export type QueryParams = Record<string, LbugValue>;

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private database: LbugDatabase | null = null;
  private connection: LbugConnection | null = null;

  constructor(@Inject(DATA_DIR) private readonly dataDir: string) {}

  onModuleInit(): void {
    const dbPath = `${this.dataDir}/ladybug-db`;
    this.database = new Database(dbPath);
    this.connection = new Connection(this.database);
    this.logger.log("LadybugDB initialized");
  }

  async onModuleDestroy(): Promise<void> {
    this.connection = null;
    if (this.database !== null) {
      await this.database.close();
      this.database = null;
    }
  }

  getConnection(): LbugConnection {
    if (this.connection === null) {
      throw new Error("Database not initialized.");
    }
    return this.connection;
  }

  async query<Row = unknown>(
    cypher: string,
    params?: QueryParams,
  ): Promise<Row[]> {
    const conn = this.getConnection();
    if (params === undefined) {
      const result = await conn.query(cypher);
      return extractRows<Row>(result);
    }
    const stmt = await conn.prepare(cypher);
    const result = await conn.execute(stmt, params);
    return extractRows<Row>(result);
  }
}

function extractRows<Row>(result: unknown): Row[] {
  const source = Array.isArray(result) ? result[0] : result;
  return (source as { getAllSync(): unknown[] }).getAllSync() as Row[];
}
