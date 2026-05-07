import "reflect-metadata";
import {
  describe,
  test,
  beforeAll,
  afterAll,
  expect,
} from "bun:test";
import { Test, type TestingModule } from "@nestjs/testing";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { and, given, then, when } from "@tests/bdd.js";
import {
  conversationJsonPath,
  ensureNoesisLayout,
  topicJsonPath,
} from "@noesis/shared-contracts/source-files.js";
import {
  DATA_DIR,
  PROJECT_DIR,
} from "@noesis/mcp/noesis-graph/config/config.module.js";
import { DatabaseService } from "@noesis/mcp/noesis-graph/database/database.service.js";
import { FileSyncService } from "@noesis/mcp/noesis-graph/file-sync/file-sync.service.js";
import { GraphProjectionService } from "@noesis/mcp/noesis-graph/file-sync/graph-projection.service.js";
import { SourceFilesRepository } from "@noesis/mcp/noesis-graph/file-sync/source-files.repository.js";
import { StalenessService } from "@noesis/mcp/noesis-graph/file-sync/staleness.service.js";
import { DesignDocsRepository } from "@noesis/mcp/noesis-graph/knowledge/design-docs/design-docs.repository.js";
import { SchemaService } from "@noesis/mcp/noesis-graph/knowledge/schema/schema.service.js";

describe("StalenessService — flagging topics and decisions when their referenced source shas drift", () => {
  let module: TestingModule;
  let staleness: StalenessService;
  let fileSync: FileSyncService;
  let sourceFiles: SourceFilesRepository;
  let projectDir: string;

  beforeAll(async () => {
    projectDir = mkdtempSync(join(tmpdir(), "noesis-staleness-"));
    ensureNoesisLayout(projectDir);
    module = await Test.createTestingModule({
      providers: [
        DatabaseService,
        SchemaService,
        DesignDocsRepository,
        SourceFilesRepository,
        GraphProjectionService,
        FileSyncService,
        StalenessService,
        { provide: DATA_DIR, useValue: projectDir },
        { provide: PROJECT_DIR, useValue: projectDir },
      ],
    }).compile();
    await module.init();
    await module.get(DesignDocsRepository).initSchema();
    fileSync = module.get(FileSyncService);
    sourceFiles = module.get(SourceFilesRepository);
    staleness = module.get(StalenessService);
  });

  afterAll(async () => {
    await module.close();
    rmSync(projectDir, { recursive: true, force: true });
  });

  test("a topic is flagged stale once the referenced conversation file's sha changes", async () => {
    let staleBefore: number;
    let staleAfter: number;
    let conversationJson: string;
    let topicPath: string;
    let knownSha: string;

    await given(
      "a topic that references one structured conversation file by its current sha",
      async () => {
        conversationJson = conversationJsonPath(projectDir, "c-ref");
        writeFileSync(
          conversationJson,
          JSON.stringify({
            conversation_id: "c-ref",
            time: "t",
            main_topic: "m",
            turns: [],
            edited_by_user: false,
          }),
        );
        await fileSync.loadFile(conversationJson);
        knownSha = (await sourceFiles.get(conversationJson))!.sha;

        topicPath = topicJsonPath(projectDir, "t-stale");
        writeFileSync(
          topicPath,
          JSON.stringify({
            id: "t-stale",
            title: "T",
            short_summary: "s",
            long_summary: "l",
            items: [
              {
                type: "idea_unit_ref",
                conversation_id: "c-ref",
                turn_index: 0,
                idea_unit_index: 0,
                source_sha: knownSha,
              },
            ],
            edited_by_user: false,
          }),
        );
        await fileSync.loadFile(topicPath);
      },
    );
    await when("a first refresh runs while the referenced sha still matches", async () => {
      staleBefore = await staleness.refreshStaleFlags();
    });
    await and(
      "the referenced conversation file is mutated and re-loaded so its sha drifts",
      async () => {
        writeFileSync(
          conversationJson,
          JSON.stringify({
            conversation_id: "c-ref",
            time: "t",
            main_topic: "m-changed",
            turns: [],
            edited_by_user: false,
          }),
        );
        await fileSync.loadFile(conversationJson);
        staleAfter = await staleness.refreshStaleFlags();
      },
    );
    await then(
      "the topic was not stale before the drift but is stale after it",
      () => {
        expect(staleBefore).toBe(0);
        expect(staleAfter).toBeGreaterThan(0);
      },
    );
  });
});
