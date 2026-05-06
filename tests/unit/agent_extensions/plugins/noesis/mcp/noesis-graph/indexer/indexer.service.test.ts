import "reflect-metadata";
import {
  describe,
  test,
  beforeAll,
  afterAll,
  beforeEach,
  expect,
} from "bun:test";
import { Test, type TestingModule } from "@nestjs/testing";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { and, given, then, when } from "@tests/bdd.js";
import {
  conversationJsonPath,
  conversationMdPath,
  designDocJsonPath,
  ensureNoesisLayout,
  topicJsonPath,
} from "@noesis/shared-contracts/source-files.js";
import {
  DATA_DIR,
  PROJECT_DIR,
} from "@noesis/mcp/noesis-graph/config/config.module.js";
import { DatabaseService } from "@noesis/mcp/noesis-graph/database/database.service.js";
import { DesignDocsRepository } from "@noesis/mcp/noesis-graph/knowledge/design-docs/design-docs.repository.js";
import { SchemaService } from "@noesis/mcp/noesis-graph/knowledge/schema/schema.service.js";
import { FileLoaderService } from "@noesis/mcp/noesis-graph/file-sync/file-loader.service.js";
import { SourceFilesRepository } from "@noesis/mcp/noesis-graph/file-sync/source-files.repository.js";
import { IndexStateService } from "@noesis/mcp/noesis-graph/indexer/index-state.service.js";
import { IndexerService } from "@noesis/mcp/noesis-graph/indexer/indexer.service.js";

interface Ctx {
  module: TestingModule;
  db: DatabaseService;
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
    db: module.get(DatabaseService),
    indexer: module.get(IndexerService),
    state: module.get(IndexStateService),
    sourceFiles: module.get(SourceFilesRepository),
  };
}

describe("IndexerService — discovering and reconciling on-disk noesis files", () => {
  let projectDir: string;
  let ctx: Ctx;

  beforeAll(async () => {
    projectDir = mkdtempSync(join(tmpdir(), "noesis-indexer-"));
    ctx = await createCtx(projectDir);
  });

  afterAll(async () => {
    await ctx.module.close();
    rmSync(projectDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    rmSync(join(projectDir, "noesis"), { recursive: true, force: true });
    await ctx.db.query("MATCH (s:SourceFile) DETACH DELETE s");
  });

  test("a first run on an empty project creates the layout and ends consistent", async () => {
    await given("a project directory with no noesis subtree yet", () => {});
    await when("the indexer runs a full index pass", async () => {
      await ctx.indexer.runFullIndex();
    });
    await then("the index state ends as 'consistent' with zero files seen", () => {
      expect(ctx.state.get().state).toBe("consistent");
      expect(ctx.state.get().files_total).toBe(0);
    });
    await and("the SourceFile catalogue is empty", async () => {
      expect(await ctx.sourceFiles.listAll()).toEqual([]);
    });
  });

  test(
    "a single pass discovers conversations, topics, and design docs in the layout",
    async () => {
      let mdPath: string;
      let sidecarPath: string;
      let topicPath: string;
      let ddPath: string;

      await given(
        "the noesis layout populated with one md, one sidecar, one topic, and one design doc",
        () => {
          ensureNoesisLayout(projectDir);
          mdPath = conversationMdPath(projectDir, "convo-1");
          sidecarPath = conversationJsonPath(projectDir, "convo-1");
          topicPath = topicJsonPath(projectDir, "topic-1");
          ddPath = designDocJsonPath(projectDir, "dd-1");
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
            JSON.stringify({ id: "dd-1", name: "n", description: "d" }),
          );
        },
      );
      await when("the indexer runs a full index pass", async () => {
        await ctx.indexer.runFullIndex();
      });
      await then(
        "the state ends consistent with all four files counted as processed",
        () => {
          const s = ctx.state.get();
          expect(s.state).toBe("consistent");
          expect(s.files_total).toBe(4);
          expect(s.files_processed).toBe(4);
        },
      );
      await and(
        "each file is registered with its entity kind in the source-file catalogue",
        async () => {
          const entries = await ctx.sourceFiles.listAll();
          expect(entries).toHaveLength(4);
          const byPath = new Map(entries.map((e) => [e.path, e]));
          expect(byPath.get(mdPath)?.kind).toBe("conversation");
          expect(byPath.get(sidecarPath)?.kind).toBe("conversation");
          expect(byPath.get(topicPath)?.kind).toBe("topic");
          expect(byPath.get(ddPath)?.kind).toBe("design_doc");
        },
      );
    },
  );

  test("files with non md/json extensions are ignored during discovery", async () => {
    await given(
      "a noesis layout containing one valid md file and one stray .txt file",
      () => {
        ensureNoesisLayout(projectDir);
        writeFileSync(conversationMdPath(projectDir, "good"), "x");
        writeFileSync(
          conversationMdPath(projectDir, "ignored").replace(/\.md$/, ".txt"),
          "x",
        );
      },
    );
    await when("the indexer runs", async () => {
      await ctx.indexer.runFullIndex();
    });
    await then(
      "only the .md file is registered; the .txt file is not in the catalogue",
      async () => {
        const entries = await ctx.sourceFiles.listAll();
        expect(entries.map((e) => e.entity_id)).toEqual(["good"]);
      },
    );
  });

  test("a re-index after content changes records a new sha for the changed file", async () => {
    let firstSha: string | undefined;
    let secondSha: string | undefined;
    let path: string;

    await given(
      "a topic file that has been indexed once with its original content",
      async () => {
        ensureNoesisLayout(projectDir);
        path = topicJsonPath(projectDir, "tpc");
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
        firstSha = (await ctx.sourceFiles.get(path))?.sha;
      },
    );
    await when("the file is rewritten with new content and a re-index runs", async () => {
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
      secondSha = (await ctx.sourceFiles.get(path))?.sha;
    });
    await then(
      "the new sha differs from the original so dependents can detect drift",
      () => {
        expect(firstSha).toBeDefined();
        expect(secondSha).toBeDefined();
        expect(secondSha).not.toBe(firstSha);
      },
    );
  });

  test("a file deleted from disk is purged from the SourceFile catalogue on the next pass", async () => {
    let beforeRemoval: number;
    let afterRemoval: number;
    let path: string;

    await given(
      "a conversation md file that has been indexed once",
      async () => {
        ensureNoesisLayout(projectDir);
        path = conversationMdPath(projectDir, "vanish");
        writeFileSync(path, "x");
        await ctx.indexer.runFullIndex();
        beforeRemoval = (await ctx.sourceFiles.listAll()).length;
      },
    );
    await when("the file is removed and the indexer runs again", async () => {
      rmSync(path);
      await ctx.indexer.runFullIndex();
      afterRemoval = (await ctx.sourceFiles.listAll()).length;
    });
    await then("the catalogue shrinks to drop the vanished entry", () => {
      expect(beforeRemoval).toBe(1);
      expect(afterRemoval).toBe(0);
    });
  });
});
