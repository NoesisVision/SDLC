import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AppModule } from "./app.module.js";
import { FileLogger } from "./logging/file-logger.js";
import {
  configureToolOutputDir,
  pruneStaleOutputs,
} from "./mcp-tool-output.js";
import {
  ensureTmpDir,
  scopeDataDirToProject,
} from "../../shared-contracts/plugin-paths.js";
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
import { IndexerService } from "./indexer/indexer.service.js";
import { TopicsService } from "./knowledge/topics/topics.service.js";
import { registerTopicsTools } from "./knowledge/topics/topics.mcp.js";
import { ImplementationCheckService } from "./implementation-check/implementation-check.service.js";
import { registerImplementationCheckTools } from "./implementation-check/implementation-check.mcp.js";

export async function startServer(): Promise<void> {
  const [argDataDir, argProjectDir] = process.argv.slice(2);
  const baseDataDir = argDataDir || process.env["CLAUDE_PLUGIN_DATA"];
  const projectDir =
    argProjectDir ||
    process.env["CLAUDE_PROJECT_DIR"] ||
    process.env["NOESIS_PROJECT_DIR"];

  if (!baseDataDir) {
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

  const dataDir = scopeDataDirToProject(baseDataDir, projectDir);
  const toolOutputDir = ensureTmpDir(dataDir);
  configureToolOutputDir(toolOutputDir);
  pruneStaleOutputs();

  const logger = new FileLogger(dataDir);
  logger.log(`Plugin data base: ${baseDataDir}`, "Bootstrap");
  logger.log(`Project dir: ${projectDir}`, "Bootstrap");
  logger.log(`Scoped data dir: ${dataDir}`, "Bootstrap");

  const mcp = new McpServer({ name: "noesis-graph", version: "0.1.0" });

  try {
    const app = await NestFactory.create(
      AppModule.forRoot(dataDir, projectDir),
      { logger },
    );
    app.enableShutdownHooks();
    await app.listen(0);

    const indexer = app.get(IndexerService);

    registerScannerTools(mcp, app.get(ScannerService), app.get(InvocationsService));
    registerTopicsTools(mcp, app.get(TopicsService), indexer);
    registerDecisionsTools(mcp, app.get(DecisionsService), indexer);
    registerConversationsTools(mcp, app.get(ConversationsService), indexer);
    registerDocumentsTools(mcp, app.get(DocumentsService), indexer);
    registerDesignDocsTools(mcp, app.get(DesignDocsService), indexer);
    registerImplementationCheckTools(mcp, app.get(ImplementationCheckService));
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
  const argv = browserCommand(url);
  try {
    Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"] });
  } catch {
    logger.warn(`Could not open browser. Visit ${url} manually.`, "Bootstrap");
  }
}

function browserCommand(url: string): string[] {
  switch (process.platform) {
    case "win32":
      return ["cmd", "/c", "start", "", url];
    case "darwin":
      return ["open", url];
    default:
      return ["xdg-open", url];
  }
}

if (import.meta.main) {
  startServer().catch((err: Error) => {
    console.error(`[noesis] Fatal: ${err.message}`);
    process.exit(1);
  });
}
