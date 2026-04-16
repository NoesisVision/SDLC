import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PROJECT_DIR } from "../config/config.module.js";

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

  constructor(@Inject(PROJECT_DIR) private readonly projectDir: string) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.connect();
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

  private async connect(): Promise<void> {
    this.state = { status: "connecting" };

    try {
      this.client = new Client({ name: "noesis-graph", version: "0.1.0" });
      const transport = new StdioClientTransport({
        command: "uvx",
        args: [
          "--from", "git+https://github.com/oraios/serena",
          "serena", "start-mcp-server",
          "--context", "claude-code",
          "--project", this.projectDir,
        ],
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
