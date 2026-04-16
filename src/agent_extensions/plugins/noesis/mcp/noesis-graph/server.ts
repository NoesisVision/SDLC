import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "path";
import { initDatabase } from "./db.js";
import { startHttpServer } from "./http.js";
import { initSerena, closeSerena } from "./serena.js";
import { closeDatabase } from "./db.js";

export async function startServer(): Promise<void> {
  const dataDir = process.env["CLAUDE_PLUGIN_DATA"];
  if (!dataDir) {
    throw new Error("CLAUDE_PLUGIN_DATA environment variable is required");
  }

  initDatabase(dataDir);
  console.error("[noesis] LadybugDB initialized");

  await initSerena(dataDir);

  const staticDir = resolve(import.meta.dirname, "ui/dist");
  const httpServer = startHttpServer({ staticDir });
  console.error(`[noesis] Noesis Graph available at http://localhost:${httpServer.port}`);

  openBrowser(`http://localhost:${httpServer.port}`);

  registerShutdownHandler();

  const mcp = new McpServer({ name: "noesis", version: "0.1.0" });
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

function registerShutdownHandler(): void {
  const shutdown = async () => {
    console.error("[noesis] Shutting down...");
    await closeSerena();
    await closeDatabase();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  try {
    Bun.spawn([cmd, url], {
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    console.error(`[noesis] Could not open browser. Visit ${url} manually.`);
  }
}

if (import.meta.main) {
  startServer().catch((err: Error) => {
    console.error(`[noesis] Fatal: ${err.message}`);
    process.exit(1);
  });
}
