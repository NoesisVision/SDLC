import "reflect-metadata";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ensureNoesisLayout } from "../../../shared-contracts/source-files.js";
import { AppModule } from "../app.module.js";
import { DatabaseService } from "../database/database.service.js";
import { ScannerRepository } from "../scanner/scanner.repository.js";
import { InvocationsRepository } from "../scanner/invocations/invocations.repository.js";
import { ConversationsRepository } from "../knowledge/conversations/conversations.repository.js";
import { DecisionsRepository } from "../knowledge/decisions/decisions.repository.js";
import { DesignDocsRepository } from "../knowledge/design-docs/design-docs.repository.js";
import { DocumentsRepository } from "../knowledge/documents/documents.repository.js";
import { TopicsRepository } from "../knowledge/topics/topics.repository.js";
import { seedDevDatabase } from "./dev-seed.js";
import { clearDiscovery, writeDiscovery } from "./dev-discovery.js";

export async function startDevServer(): Promise<void> {
  const logger = new Logger("DevServer");
  const externalDataDir = resolveExternalDir("NOESIS_DEV_DATA_DIR");
  const dataDir = externalDataDir ?? mkdtempSync(join(tmpdir(), "noesis-graph-dev-"));
  const ownsDataDir = externalDataDir === null;
  const externalProjectDir = resolveExternalDir("NOESIS_DEV_PROJECT_DIR");
  const projectDir = externalProjectDir ?? mkdtempSync(join(tmpdir(), "noesis-graph-dev-project-"));
  const ownsProjectDir = externalProjectDir === null;
  ensureNoesisLayout(projectDir);
  const skipSeed = process.env["NOESIS_DEV_NO_SEED"] === "1";
  logger.log(`Data dir: ${dataDir}${ownsDataDir ? " (ephemeral)" : ""}`);
  logger.log(`Project dir: ${projectDir}${ownsProjectDir ? " (ephemeral)" : ""}`);

  const app = await NestFactory.create(AppModule.forRoot(dataDir, projectDir), {
    logger,
  });
  app.enableShutdownHooks();
  await app.init();

  if (skipSeed) {
    logger.log("NOESIS_DEV_NO_SEED=1 — skipping fixture seeding");
  } else {
    await seedDevDatabase({
      scanner: app.get(ScannerRepository),
      invocations: app.get(InvocationsRepository),
      topics: app.get(TopicsRepository),
      documents: app.get(DocumentsRepository),
      conversations: app.get(ConversationsRepository),
      decisions: app.get(DecisionsRepository),
      designDocs: app.get(DesignDocsRepository),
      db: app.get(DatabaseService),
    });
  }

  await app.listen(0);
  const url = await app.getUrl();
  writeDiscovery({
    url,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  logger.log(`Noesis Graph dev backend ready at ${url}`);
  logger.log("Vite dev server (bun run dev in ui/) will pick this up automatically.");

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`Received ${signal}, shutting down...`);
    clearDiscovery();
    try {
      await app.close();
    } catch (err) {
      logger.error(`Error closing app: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (ownsDataDir) {
      try {
        rmSync(dataDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
    if (ownsProjectDir) {
      try {
        rmSync(projectDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

function resolveExternalDir(envVar: string): string | null {
  const value = process.env[envVar];
  if (value === undefined || value === "") return null;
  const dir = resolve(value);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

if (import.meta.main) {
  startDevServer().catch((err: Error) => {
    console.error(`[noesis-dev] Fatal: ${err.message}`);
    clearDiscovery();
    process.exit(1);
  });
}
