import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Test, type TestingModule } from "@nestjs/testing";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  conversationJsonPath,
  conversationMdPath,
  designDocJsonPath,
  ensureNoesisLayout,
  topicJsonPath,
} from "../../../shared-contracts/source-files.js";
import { DATA_DIR, PROJECT_DIR } from "../config/config.module.js";
import { DatabaseService } from "../database/database.service.js";
import { DesignDocsRepository } from "../knowledge/design-docs/design-docs.repository.js";
import { SchemaService } from "../knowledge/schema/schema.service.js";
import { FileLoaderService } from "../file-sync/file-loader.service.js";
import { SourceFilesRepository } from "../file-sync/source-files.repository.js";
import { IndexStateService } from "./index-state.service.js";
import { IndexerService } from "./indexer.service.js";

interface Ctx {
  module: TestingModule;
  indexer: IndexerService;
  state: IndexStateService;
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
      { provide: DATA_DIR, useValue: projectDir },
      { provide: PROJECT_DIR, useValue: projectDir },
    ],
  }).compile();
  await module.init();
  await module.get(DesignDocsRepository).initSchema();
  return {
    module,
    indexer: module.get(IndexerService),
    state: module.get(IndexStateService),
    sourceFiles: module.get(SourceFilesRepository),
  };
}

describe("IndexerService", () => {
  let projectDir: string;
  let ctx: Ctx;

  beforeEach(async () => {
    projectDir = mkdtempSync(join(tmpdir(), "noesis-indexer-"));
    ctx = await createCtx(projectDir);
  });

  afterEach(async () => {
    await ctx.module.close();
    rmSync(projectDir, { recursive: true, force: true });
  });

  test("creates the noesis layout when missing and reaches consistent state", async () => {
    await ctx.indexer.runFullIndex();
    expect(ctx.state.get().state).toBe("consistent");
    expect(ctx.state.get().files_total).toBe(0);
    expect(await ctx.sourceFiles.listAll()).toEqual([]);
  });

  test("indexes md and json files in the noesis subdirs", async () => {
    ensureNoesisLayout(projectDir);
    const mdPath = conversationMdPath(projectDir, "convo-1");
    const sidecarPath = conversationJsonPath(projectDir, "convo-1");
    const topicPath = topicJsonPath(projectDir, "topic-1");
    const ddPath = designDocJsonPath(projectDir, "dd-1");
    writeFileSync(mdPath, "<!-- conversation_id: convo-1 -->\n# hi\n");
    writeFileSync(
      sidecarPath,
      JSON.stringify({
        conversation_id: "convo-1",
        time: "t",
        main_topic: "m",
        turns: [],
      }),
    );
    writeFileSync(
      topicPath,
      JSON.stringify({
        id: "topic-1",
        title: "T",
        short_summary: "s",
        long_summary: "l",
        items: [],
      }),
    );
    writeFileSync(
      ddPath,
      JSON.stringify({
        id: "dd-1",
        name: "n",
        description: "d",
      }),
    );

    await ctx.indexer.runFullIndex();

    expect(ctx.state.get().state).toBe("consistent");
    expect(ctx.state.get().files_total).toBe(4);
    expect(ctx.state.get().files_processed).toBe(4);

    const entries = await ctx.sourceFiles.listAll();
    expect(entries).toHaveLength(4);
    const byPath = new Map(entries.map((e) => [e.path, e]));
    expect(byPath.get(mdPath)?.kind).toBe("conversation");
    expect(byPath.get(sidecarPath)?.kind).toBe("conversation");
    expect(byPath.get(topicPath)?.kind).toBe("topic");
    expect(byPath.get(ddPath)?.kind).toBe("design_doc");
  });

  test("ignores files with non md/json extensions", async () => {
    ensureNoesisLayout(projectDir);
    writeFileSync(conversationMdPath(projectDir, "good"), "x");
    writeFileSync(
      conversationMdPath(projectDir, "ignored").replace(/\.md$/, ".txt"),
      "x",
    );
    await ctx.indexer.runFullIndex();
    const entries = await ctx.sourceFiles.listAll();
    expect(entries.map((e) => e.entity_id)).toEqual(["good"]);
  });

  test("re-indexing after a topic file changes updates the stored sha", async () => {
    ensureNoesisLayout(projectDir);
    const path = topicJsonPath(projectDir, "tpc");
    writeFileSync(
      path,
      JSON.stringify({
        id: "tpc",
        title: "First",
        short_summary: "s",
        long_summary: "l",
        items: [],
      }),
    );
    await ctx.indexer.runFullIndex();
    const firstSha = (await ctx.sourceFiles.get(path))?.sha;

    writeFileSync(
      path,
      JSON.stringify({
        id: "tpc",
        title: "Second",
        short_summary: "s",
        long_summary: "l",
        items: [],
        edited_by_user: true,
      }),
    );
    await ctx.indexer.runFullIndex();
    const after = await ctx.sourceFiles.get(path);
    expect(after?.sha).not.toBe(firstSha);
  });

  test("removes registry entries for files that disappear", async () => {
    ensureNoesisLayout(projectDir);
    const path = conversationMdPath(projectDir, "vanish");
    writeFileSync(path, "x");
    await ctx.indexer.runFullIndex();
    expect(await ctx.sourceFiles.listAll()).toHaveLength(1);
    rmSync(path);
    await ctx.indexer.runFullIndex();
    expect(await ctx.sourceFiles.listAll()).toEqual([]);
  });
});
