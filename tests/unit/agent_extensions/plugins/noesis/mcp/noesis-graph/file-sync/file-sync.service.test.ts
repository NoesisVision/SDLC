import "reflect-metadata";
import {
  describe,
  test,
  beforeAll,
  afterAll,
  expect,
} from "bun:test";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { and, given, then, when } from "@tests/bdd.js";
import {
  conversationJsonPath,
  conversationMdPath,
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
import { FileSyncService } from "@noesis/mcp/noesis-graph/file-sync/file-sync.service.js";
import { SourceFilesRepository } from "@noesis/mcp/noesis-graph/file-sync/source-files.repository.js";

describe("FileSyncService — registering and reconciling on-disk noesis files", () => {
  let module: TestingModule;
  let fileSync: FileSyncService;
  let sourceFiles: SourceFilesRepository;
  let projectDir: string;

  beforeAll(async () => {
    projectDir = mkdtempSync(join(tmpdir(), "noesis-file-sync-"));
    ensureNoesisLayout(projectDir);
    module = await Test.createTestingModule({
      providers: [
        DatabaseService,
        SchemaService,
        DesignDocsRepository,
        SourceFilesRepository,
        FileSyncService,
        { provide: DATA_DIR, useValue: projectDir },
        { provide: PROJECT_DIR, useValue: projectDir },
      ],
    }).compile();
    await module.init();
    await module.get(DesignDocsRepository).initSchema();
    fileSync = module.get(FileSyncService);
    sourceFiles = module.get(SourceFilesRepository);
  });

  afterAll(async () => {
    await module.close();
    rmSync(projectDir, { recursive: true, force: true });
  });

  test("Loading a structured conversation file (json) registers the file and upserts the conversation row", async () => {
    let result: Awaited<ReturnType<FileSyncService["loadFile"]>>;
    let jsonPath: string;

    await given("a freshly written structured conversation file with no edit flag", () => {
      jsonPath = conversationJsonPath(projectDir, "c1");
      writeFileSync(
        jsonPath,
        JSON.stringify({
          conversation_id: "c1",
          time: "2026-04-29",
          main_topic: "Topic",
          turns: [],
          edited_by_user: false,
        })
      );
    });
    await when("the file sync service processes the structured conversation file", async () => {
      result = await fileSync.loadFile(jsonPath);
    });
    await then("the file is recognised as a conversation with no user edit", () => {
      expect(result?.kind).toBe("conversation");
      expect(result?.user_edit_detected).toBe(false);
    });
    await and(
      "a SourceFile row is registered linking the path to the conversation entity id",
      async () => {
        const row = await sourceFiles.get(jsonPath);
        expect(row?.entity_id).toBe("c1");
        expect(row?.kind).toBe("conversation");
      },
    );
  });

  test("a structured topic file that drifts on disk is detected as a user edit and self-heals the flag", async () => {
    let secondLoad: Awaited<ReturnType<FileSyncService["loadFile"]>>;
    let onDiskAfter: { edited_by_user: boolean };
    let path: string;

    await given(
      "a structured topic file that has been previously registered by the file sync service",
      async () => {
        path = topicJsonPath(projectDir, "t1");
        const initial = {
          id: "t1",
          title: "First",
          short_summary: "s",
          long_summary: "l",
          items: [],
          edited_by_user: false,
        };
        writeFileSync(path, JSON.stringify(initial));
        await fileSync.loadFile(path);
      },
    );
    await when(
      "the user mutates the file outside the file sync service and a re-load is triggered",
      async () => {
        const edited = {
          id: "t1",
          title: "User Edited",
          short_summary: "s",
          long_summary: "l",
          items: [],
          edited_by_user: false,
        };
        writeFileSync(path, JSON.stringify(edited));
        secondLoad = await fileSync.loadFile(path);
      },
    );
    await then("the file sync service reports a user edit so callers can stop overwriting it", () => {
      expect(secondLoad?.user_edit_detected).toBe(true);
    });
    await and(
      "the on-disk file has been patched to set edited_by_user=true",
      () => {
        onDiskAfter = JSON.parse(readFileSync(path, "utf-8"));
        expect(onDiskAfter.edited_by_user).toBe(true);
      },
    );
  });

  test(
    "registerWritten records a file the file sync service itself wrote so a follow-up load does not flag a user edit",
    async () => {
      let result: Awaited<ReturnType<FileSyncService["loadFile"]>>;

      await given(
        "a structured topic file that the system writes through registerWritten",
        async () => {
          const path = topicJsonPath(projectDir, "t2");
          writeFileSync(
            path,
            JSON.stringify({
              id: "t2",
              title: "T",
              short_summary: "s",
              long_summary: "l",
              items: [],
              edited_by_user: false,
            }),
          );
          await fileSync.registerWritten(path);
        },
      );
      await when(
        "the watcher's later loadFile callback runs against the same content",
        async () => {
          result = await fileSync.loadFile(topicJsonPath(projectDir, "t2"));
        },
      );
      await then(
        "no user edit is reported because the registry sha already matches",
        () => {
          expect(result?.user_edit_detected).toBe(false);
        },
      );
    },
  );

  test(
    "refreshStaleFlags flips a topic to stale when the referenced structured conversation file's sha changes",
    async () => {
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
        staleBefore = await fileSync.refreshStaleFlags();
      });
      await and(
        "the structured conversation file is then mutated and re-loaded so its sha drifts",
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
          staleAfter = await fileSync.refreshStaleFlags();
        },
      );
      await then(
        "the topic was not stale before the drift but is stale after it",
        () => {
          expect(staleBefore).toBe(0);
          expect(staleAfter).toBeGreaterThan(0);
        },
      );
    },
  );

  test(
    "loading a conversation markdown file detects the entity from the filename and stores its md sha",
    async () => {
      let result: Awaited<ReturnType<FileSyncService["loadFile"]>>;

      await given("a conversation markdown file present on disk", () => {
        const mdPath = conversationMdPath(projectDir, "c-md");
        writeFileSync(mdPath, "<!-- conversation_id: c-md -->\n# hi\n");
      });
      await when("the file sync service processes the markdown file", async () => {
        result = await fileSync.loadFile(conversationMdPath(projectDir, "c-md"));
      });
      await then("the kind is 'conversation' and the id matches the filename", () => {
        expect(result?.kind).toBe("conversation");
        expect(result?.id).toBe("c-md");
      });
    },
  );

  test("paths outside the noesis root are not treated as source files", async () => {
    let detected: ReturnType<FileSyncService["detect"]>;
    let result: Awaited<ReturnType<FileSyncService["loadFile"]>>;

    await given("an arbitrary path that does not live under <projectDir>/noesis/", () => {});
    await when("the file sync service is asked to detect and load that path", async () => {
      const stray = join(projectDir, "elsewhere", "stray.json");
      detected = fileSync.detect(stray);
      result = await fileSync.loadFile(stray);
    });
    await then("detection returns null", () => {
      expect(detected).toBeNull();
    });
    await and("loadFile is a no-op that returns null", () => {
      expect(result).toBeNull();
    });
  });
});
