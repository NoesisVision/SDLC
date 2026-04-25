import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AppModule } from "./app.module.js";
import { FileLogger } from "./logging/file-logger.js";
import { ScannerService } from "./scanner/scanner.service.js";
import { InvocationsService } from "./scanner/invocations/invocations.service.js";
import { registerScannerTools } from "./scanner/scanner.mcp.js";
import { ConversationsService } from "./knowledge/conversations/conversations.service.js";
import { registerConversationsTools } from "./knowledge/conversations/conversations.mcp.js";
import { DecisionsService } from "./knowledge/decisions/decisions.service.js";
import { registerDecisionsTools } from "./knowledge/decisions/decisions.mcp.js";
import { DesignDocsService } from "./knowledge/design-docs/design-docs.service.js";
import { registerDesignDocsTools } from "./knowledge/design-docs/design-docs.mcp.js";
import { DocumentsService } from "./knowledge/documents/documents.service.js";
import { registerDocumentsTools } from "./knowledge/documents/documents.mcp.js";
import { TopicsService } from "./knowledge/topics/topics.service.js";
import { registerTopicsTools } from "./knowledge/topics/topics.mcp.js";

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

  const mcp = new McpServer({ name: "noesis-graph", version: "0.1.0" });

  try {
    const app = await NestFactory.create(
      AppModule.forRoot(dataDir, projectDir),
      { logger },
    );
    app.enableShutdownHooks();
    await app.listen(0);

    registerScannerTools(mcp, app.get(ScannerService), app.get(InvocationsService));
    registerTopicsTools(mcp, app.get(TopicsService));
    registerDecisionsTools(mcp, app.get(DecisionsService));
    registerConversationsTools(mcp, app.get(ConversationsService));
    registerDocumentsTools(
      mcp,
      app.get(DocumentsService),
      app.get(DesignDocsService),
    );
    registerDesignDocsTools(mcp, app.get(DesignDocsService));
    logger.log("MCP tools registered", "Bootstrap");

    const url = await app.getUrl();
    logger.log(`Noesis Graph available at ${url}`, "Bootstrap");
    openBrowser(url, logger);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`App startup failed: ${message}`, undefined, "Bootstrap");
  }

  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  logger.log("MCP transport connected", "Bootstrap");
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
