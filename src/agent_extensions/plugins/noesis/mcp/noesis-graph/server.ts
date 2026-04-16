import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AppModule } from "./app.module.js";
import { FileLogger } from "./logging/file-logger.js";

export async function startServer(): Promise<void> {
  const [argDataDir, argProjectDir] = process.argv.slice(2);
  const dataDir = argDataDir || process.env["CLAUDE_PLUGIN_DATA"];
  const projectDir =
    argProjectDir ||
    process.env["CLAUDE_PROJECT_DIR"] ||
    process.env["NOESIS_PROJECT_DIR"];

  if (!dataDir) {
    throw new Error(
      "Plugin data directory is required.\n" +
        "Provide as first CLI arg or set CLAUDE_PLUGIN_DATA env var.",
    );
  }

  if (!projectDir) {
    throw new Error(
      "Project directory is required.\n" +
        "Provide as second CLI arg or set CLAUDE_PROJECT_DIR env var.",
    );
  }

  const logger = new FileLogger(dataDir);
  logger.log(`Data dir: ${dataDir}`, "Bootstrap");
  logger.log(`Project dir: ${projectDir}`, "Bootstrap");

  const mcp = new McpServer({ name: "noesis", version: "0.1.0" });
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  logger.log("MCP transport connected", "Bootstrap");

  startApp(dataDir, projectDir, logger);
}

async function startApp(
  dataDir: string,
  projectDir: string,
  logger: FileLogger,
): Promise<void> {
  try {
    const app = await NestFactory.create(
      AppModule.forRoot(dataDir, projectDir),
      { logger },
    );
    app.enableShutdownHooks();
    await app.listen(0);

    const url = await app.getUrl();
    logger.log(`Noesis Graph available at ${url}`, "Bootstrap");
    openBrowser(url, logger);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`App startup failed: ${message}`, undefined, "Bootstrap");
  }
}

function openBrowser(url: string, logger: FileLogger): void {
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  try {
    Bun.spawn([cmd, url], {
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    logger.warn(`Could not open browser. Visit ${url} manually.`, "Bootstrap");
  }
}

if (import.meta.main) {
  startServer().catch((err: Error) => {
    console.error(`[noesis] Fatal: ${err.message}`);
    process.exit(1);
  });
}
