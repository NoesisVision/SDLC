import {
  Injectable,
  Inject,
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
export class SerenaService implements OnModuleDestroy {
  private client: Client | null = null;
  private state: SerenaState = { status: "disconnected" };

  constructor(@Inject(PROJECT_DIR) private readonly projectDir: string) {}

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  getState(): SerenaState {
    return this.state;
  }

  async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    if (this.state.status !== "connected") {
      await this.connect();
    }
    if (this.client === null) {
      throw new Error("Serena is not connected");
    }
    const result = await this.client.callTool({ name, arguments: args });
    const text = extractText(result.content);
    if (result.isError) {
      throw new Error(`Serena tool '${name}' failed: ${text}`);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      const snippet = text.length > 200 ? `${text.slice(0, 200)}…` : text;
      throw new Error(
        `Serena tool '${name}' returned non-JSON response: ${snippet}`,
      );
    }
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

function extractText(content: unknown): string {
  if (!Array.isArray(content)) {
    return String(content);
  }
  const textBlocks = content.filter(
    (block: unknown) =>
      typeof block === "object" &&
      block !== null &&
      "type" in block &&
      (block as { type: string }).type === "text",
  );
  return textBlocks
    .map((block: unknown) => (block as { text: string }).text)
    .join("\n");
}
