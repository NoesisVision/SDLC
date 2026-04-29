import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Test, type TestingModule } from "@nestjs/testing";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  conversationJsonPath,
  conversationMdPath,
  ensureNoesisLayout,
  topicJsonPath,
} from "../../../shared-contracts/source-files.js";
import { DATA_DIR, PROJECT_DIR } from "../config/config.module.js";
import { DatabaseService } from "../database/database.service.js";
import { DesignDocsRepository } from "../knowledge/design-docs/design-docs.repository.js";
import { SchemaService } from "../knowledge/schema/schema.service.js";
import { FileLoaderService } from "./file-loader.service.js";
import { SourceFilesRepository } from "./source-files.repository.js";

let module: TestingModule;
let loader: FileLoaderService;
let sourceFiles: SourceFilesRepository;
let projectDir: string;

describe("FileLoaderService", () => {
  beforeAll(async () => {
    projectDir = mkdtempSync(join(tmpdir(), "noesis-loader-"));
    ensureNoesisLayout(projectDir);
    module = await Test.createTestingModule({
      providers: [
        DatabaseService,
        SchemaService,
        DesignDocsRepository,
        SourceFilesRepository,
        FileLoaderService,
        { provide: DATA_DIR, useValue: projectDir },
        { provide: PROJECT_DIR, useValue: projectDir },
      ],
    }).compile();
    await module.init();
    await module.get(DesignDocsRepository).initSchema();
    loader = module.get(FileLoaderService);
    sourceFiles = module.get(SourceFilesRepository);
  });

  afterAll(async () => {
    await module.close();
    rmSync(projectDir, { recursive: true, force: true });
  });

  test("registers source file and upserts the conversation row from sidecar", async () => {
    const sidecarPath = conversationJsonPath(projectDir, "c1");
    writeFileSync(
      sidecarPath,
      JSON.stringify({
        conversation_id: "c1",
        time: "2026-04-29",
        main_topic: "Topic",
        turns: [],
        edited_by_user: false,
      }),
    );
    const result = await loader.loadFile(sidecarPath);
    expect(result?.kind).toBe("conversation");
    expect(result?.user_edit_detected).toBe(false);

    const row = await sourceFiles.get(sidecarPath);
    expect(row?.entity_id).toBe("c1");
  });

  test("flags edited_by_user when on-disk content drifts from registry", async () => {
    const path = topicJsonPath(projectDir, "t1");
    const initial = {
      id: "t1",
      title: "First",
      short_summary: "s",
      long_summary: "l",
      items: [],
      edited_by_user: false,
    };
    writeFileSync(path, JSON.stringify(initial));
    await loader.loadFile(path);

    const edited = { ...initial, title: "User Edited" };
    writeFileSync(path, JSON.stringify(edited));
    const second = await loader.loadFile(path);

    expect(second?.user_edit_detected).toBe(true);
    const onDisk = JSON.parse(readFileSync(path, "utf-8"));
    expect(onDisk.edited_by_user).toBe(true);
  });

  test("registerWritten avoids false user-edit detection on next load", async () => {
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
    await loader.registerWritten(path);

    const result = await loader.loadFile(path);
    expect(result?.user_edit_detected).toBe(false);
  });

  test("refreshStaleFlags marks topic stale when referenced sidecar SHA changes", async () => {
    const sidecarPath = conversationJsonPath(projectDir, "c-ref");
    const sidecarContent = JSON.stringify({
      conversation_id: "c-ref",
      time: "t",
      main_topic: "m",
      turns: [],
      edited_by_user: false,
    });
    writeFileSync(sidecarPath, sidecarContent);
    await loader.loadFile(sidecarPath);
    const knownSha = (await sourceFiles.get(sidecarPath))!.sha;

    const topicPath = topicJsonPath(projectDir, "t-stale");
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
    await loader.loadFile(topicPath);
    let stale = await loader.refreshStaleFlags();
    expect(stale).toBe(0);

    writeFileSync(
      sidecarPath,
      JSON.stringify({
        conversation_id: "c-ref",
        time: "t",
        main_topic: "m-changed",
        turns: [],
        edited_by_user: false,
      }),
    );
    await loader.loadFile(sidecarPath);
    stale = await loader.refreshStaleFlags();
    expect(stale).toBeGreaterThan(0);
  });

  test("loads md and writes md_sha on the conversation row", async () => {
    const mdPath = conversationMdPath(projectDir, "c-md");
    writeFileSync(mdPath, "<!-- conversation_id: c-md -->\n# hi\n");
    const result = await loader.loadFile(mdPath);
    expect(result?.kind).toBe("conversation");
    expect(result?.id).toBe("c-md");
  });
});
