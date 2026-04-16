import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AppModule } from "./app.module.js";

export async function startServer(): Promise<void> {
  const dataDir = process.env["CLAUDE_PLUGIN_DATA"];
  if (!dataDir) {
    throw new Error("CLAUDE_PLUGIN_DATA environment variable is required");
  }

  const app = await NestFactory.create(AppModule, { logger: false });
  app.enableShutdownHooks();
  await app.listen(0);

  const url = await app.getUrl();
  console.error(`[noesis] Noesis Graph available at ${url}`);
  openBrowser(url);

  const mcp = new McpServer({ name: "noesis", version: "0.1.0" });
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
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
