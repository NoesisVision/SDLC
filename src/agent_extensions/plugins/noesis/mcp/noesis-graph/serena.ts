import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "path";
import { readFileSync } from "fs";

export interface SerenaConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export type SerenaStatus = "disconnected" | "connecting" | "connected" | "error";

export interface SerenaState {
  status: SerenaStatus;
  error?: string;
  tools?: string[];
}

let client: Client | null = null;
let state: SerenaState = { status: "disconnected" };

export function getSerenaState(): SerenaState {
  return state;
}

export async function closeSerena(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

export async function initSerena(dataDir: string): Promise<void> {
  const config = loadConfig(dataDir);
  if (!config) {
    console.error("[noesis] No Serena config found, skipping connection");
    return;
  }

  try {
    await connect(config);
    console.error("[noesis] Serena connected");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[noesis] Serena connection failed: ${message}`);
  }
}

function loadConfig(dataDir: string): SerenaConfig | null {
  const configPath = resolve(dataDir, "serena.json");
  try {
    const raw = readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as SerenaConfig;
  } catch {
    return null;
  }
}

async function connect(config: SerenaConfig): Promise<void> {
  state = { status: "connecting" };

  try {
    client = new Client({ name: "noesis-graph", version: "0.1.0" });
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: config.env,
    });

    await client.connect(transport);

    const { tools } = await client.listTools();
    state = {
      status: "connected",
      tools: tools.map((t: { name: string }) => t.name),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    state = { status: "error", error: message };
    throw err;
  }
}
