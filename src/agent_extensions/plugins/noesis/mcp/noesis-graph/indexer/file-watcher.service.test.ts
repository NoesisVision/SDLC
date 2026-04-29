import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Test, type TestingModule } from "@nestjs/testing";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  conversationMdPath,
  ensureNoesisLayout,
} from "../../../shared-contracts/source-files.js";
import { DATA_DIR, PROJECT_DIR } from "../config/config.module.js";
import { DatabaseService } from "../database/database.service.js";
import { DesignDocsRepository } from "../knowledge/design-docs/design-docs.repository.js";
import { SchemaService } from "../knowledge/schema/schema.service.js";
import { FileLoaderService } from "../file-sync/file-loader.service.js";
import { SourceFilesRepository } from "../file-sync/source-files.repository.js";
import { FileWatcherService } from "./file-watcher.service.js";
import { IndexStateService } from "./index-state.service.js";
import { IndexerService } from "./indexer.service.js";

async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 2000,
  pollMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error("waitFor timed out");
}

interface Ctx {
  module: TestingModule;
  indexer: IndexerService;
  watcher: FileWatcherService;
  sourceFiles: SourceFilesRepository;
}

async function createCtx(projectDir: string): Promise<Ctx> {
  const module = await Test.createTestingModule({
    providers: [
      DatabaseService,
      SchemaService,
      DesignDocsRepository,
      SourceFilesRepository,
      FileLoaderService,
      IndexStateService,
      IndexerService,
      FileWatcherService,
      { provide: DATA_DIR, useValue: projectDir },
      { provide: PROJECT_DIR, useValue: projectDir },
    ],
  }).compile();
  await module.init();
  await module.get(DesignDocsRepository).initSchema();
  const watcher = module.get(FileWatcherService);
  watcher.disableAutoStart();
  watcher.setDebounceMs(20);
  return {
    module,
    indexer: module.get(IndexerService),
    watcher,
    sourceFiles: module.get(SourceFilesRepository),
  };
}

describe("FileWatcherService", () => {
  let projectDir: string;
  let ctx: Ctx;

  beforeEach(async () => {
    projectDir = mkdtempSync(join(tmpdir(), "noesis-watcher-"));
    ensureNoesisLayout(projectDir);
    ctx = await createCtx(projectDir);
  });

  afterEach(async () => {
    ctx.watcher.stop();
    await ctx.module.close();
    rmSync(projectDir, { recursive: true, force: true });
  });

  test("triggers a re-index after a file write", async () => {
    await ctx.indexer.runFullIndex();
    expect(await ctx.sourceFiles.listAll()).toHaveLength(0);

    ctx.watcher.start();
    writeFileSync(conversationMdPath(projectDir, "watched"), "hello");

    await waitFor(async () => (await ctx.sourceFiles.listAll()).length === 1);
    const row = await ctx.sourceFiles.get(conversationMdPath(projectDir, "watched"));
    expect(row).not.toBeNull();
  });

  test("calling stop releases the watcher and pending debounce", async () => {
    await ctx.indexer.runFullIndex();
    ctx.watcher.start();
    ctx.watcher.stop();
    ctx.watcher.stop();
  });
});
