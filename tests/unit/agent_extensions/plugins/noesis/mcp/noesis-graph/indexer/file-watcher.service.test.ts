import "reflect-metadata";
import {
  describe,
  test,
  beforeEach,
  afterEach,
  expect,
} from "bun:test";
import { Test, type TestingModule } from "@nestjs/testing";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { and, given, then, when } from "@tests/bdd.js";
import {
  conversationMdPath,
  ensureNoesisLayout,
} from "@noesis/shared-contracts/source-files.js";
import {
  DATA_DIR,
  PROJECT_DIR,
} from "@noesis/mcp/noesis-graph/config/config.module.js";
import { DatabaseService } from "@noesis/mcp/noesis-graph/database/database.service.js";
import { DesignDocsRepository } from "@noesis/mcp/noesis-graph/knowledge/design-docs/design-docs.repository.js";
import { SchemaService } from "@noesis/mcp/noesis-graph/knowledge/schema/schema.service.js";
import { FileSyncService } from "@noesis/mcp/noesis-graph/file-sync/file-sync.service.js";
import { SourceFilesRepository } from "@noesis/mcp/noesis-graph/file-sync/source-files.repository.js";
import { FileWatcherService } from "@noesis/mcp/noesis-graph/indexer/file-watcher.service.js";
import { IndexStateService } from "@noesis/mcp/noesis-graph/indexer/index-state.service.js";
import { IndexerService } from "@noesis/mcp/noesis-graph/indexer/indexer.service.js";

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
      FileSyncService,
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

describe("FileWatcherService — debounced re-indexing of <projectDir>/noesis", () => {
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

  test("a new file appearing under noesis/ triggers a debounced re-index", async () => {
    await given(
      "an empty project where the watcher is started after the initial index",
      async () => {
        await ctx.indexer.runFullIndex();
        expect(await ctx.sourceFiles.listAll()).toHaveLength(0);
        ctx.watcher.start();
      },
    );
    await when(
      "a conversation markdown file is dropped into the watched layout",
      () => {
        writeFileSync(conversationMdPath(projectDir, "watched"), "hello");
      },
    );
    await then(
      "the indexer eventually registers the new file in the SourceFile catalogue",
      async () => {
        await waitFor(
          async () => (await ctx.sourceFiles.listAll()).length === 1,
        );
        const row = await ctx.sourceFiles.get(
          conversationMdPath(projectDir, "watched"),
        );
        expect(row).not.toBeNull();
        expect(row?.entity_id).toBe("watched");
      },
    );
  });

  test("calling stop is idempotent and tears down both the watcher and pending timers", async () => {
    let firstStopThrew: Error | null = null;
    let secondStopThrew: Error | null = null;

    await given(
      "a watcher that is currently running with a debounce queued",
      async () => {
        await ctx.indexer.runFullIndex();
        ctx.watcher.start();
      },
    );
    await when("the host calls stop twice in succession", () => {
      try {
        ctx.watcher.stop();
      } catch (e) {
        firstStopThrew = e as Error;
      }
      try {
        ctx.watcher.stop();
      } catch (e) {
        secondStopThrew = e as Error;
      }
    });
    await then("neither stop call throws", () => {
      expect(firstStopThrew).toBeNull();
      expect(secondStopThrew).toBeNull();
    });
    await and(
      "writing a new file after stop does NOT cause another re-index",
      async () => {
        const before = (await ctx.sourceFiles.listAll()).length;
        writeFileSync(conversationMdPath(projectDir, "ignored"), "x");
        await new Promise((r) => setTimeout(r, 100));
        const after = (await ctx.sourceFiles.listAll()).length;
        expect(after).toBe(before);
      },
    );
  });
});
