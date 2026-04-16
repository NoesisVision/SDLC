import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import lbug from "lbug";
import { DATA_DIR } from "../config/config.module.js";

const { Database, Connection } = lbug;

type LbugDatabase = InstanceType<typeof Database>;
type LbugConnection = InstanceType<typeof Connection>;

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private database: LbugDatabase | null = null;
  private connection: LbugConnection | null = null;

  constructor(@Inject(DATA_DIR) private readonly dataDir: string) {}

  onModuleInit(): void {
    const dbPath = `${this.dataDir}/ladybug-db`;
    this.database = new Database(dbPath);
    this.connection = new Connection(this.database);
    console.error("[noesis] LadybugDB initialized");
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
}
