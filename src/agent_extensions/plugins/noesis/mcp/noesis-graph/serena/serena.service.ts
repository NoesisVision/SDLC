import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "path";
import { readFileSync } from "fs";
import { DATA_DIR } from "../config/config.module.js";

export interface SerenaConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export type SerenaStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface SerenaState {
  status: SerenaStatus;
  error?: string;
  tools?: string[];
}

@Injectable()
export class SerenaService implements OnModuleInit, OnModuleDestroy {
  private client: Client | null = null;
  private state: SerenaState = { status: "disconnected" };

  constructor(@Inject(DATA_DIR) private readonly dataDir: string) {}

  async onModuleInit(): Promise<void> {
    const config = this.loadConfig();
    if (!config) {
      console.error("[noesis] No Serena config found, skipping connection");
      return;
    }

    try {
      await this.connect(config);
      console.error("[noesis] Serena connected");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[noesis] Serena connection failed: ${message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  getState(): SerenaState {
    return this.state;
  }

  private loadConfig(): SerenaConfig | null {
    const configPath = resolve(this.dataDir, "serena.json");
    try {
      const raw = readFileSync(configPath, "utf-8");
      return JSON.parse(raw) as SerenaConfig;
    } catch {
      return null;
    }
  }

  private async connect(config: SerenaConfig): Promise<void> {
    this.state = { status: "connecting" };

    try {
      this.client = new Client({ name: "noesis-graph", version: "0.1.0" });
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: config.env,
      });

      await this.client.connect(transport);

      const { tools } = await this.client.listTools();
      this.state = {
        status: "connected",
        tools: tools.map((t: { name: string }) => t.name),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.state = { status: "error", error: message };
      throw err;
    }
  }
}
