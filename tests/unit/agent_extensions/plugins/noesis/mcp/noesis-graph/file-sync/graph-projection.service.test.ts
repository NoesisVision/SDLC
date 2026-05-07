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
  computeFileSha,
  ensureNoesisLayout,
  topicJsonPath,
  decisionJsonPath,
  conversationJsonPath,
} from "@noesis/shared-contracts/source-files.js";
import {
  DATA_DIR,
  PROJECT_DIR,
} from "@noesis/mcp/noesis-graph/config/config.module.js";
import { DatabaseService } from "@noesis/mcp/noesis-graph/database/database.service.js";
import { GraphProjectionService } from "@noesis/mcp/noesis-graph/file-sync/graph-projection.service.js";
import { DesignDocsRepository } from "@noesis/mcp/noesis-graph/knowledge/design-docs/design-docs.repository.js";
import { SchemaService } from "@noesis/mcp/noesis-graph/knowledge/schema/schema.service.js";

describe("GraphProjectionService — projecting per-kind file content into graph rows", () => {
  let module: TestingModule;
  let projection: GraphProjectionService;
  let db: DatabaseService;
  let projectDir: string;

  beforeAll(async () => {
    projectDir = mkdtempSync(join(tmpdir(), "noesis-projection-"));
    ensureNoesisLayout(projectDir);
    module = await Test.createTestingModule({
      providers: [
        DatabaseService,
        SchemaService,
        DesignDocsRepository,
        GraphProjectionService,
        { provide: DATA_DIR, useValue: projectDir },
        { provide: PROJECT_DIR, useValue: projectDir },
      ],
    }).compile();
    await module.init();
    await module.get(DesignDocsRepository).initSchema();
    projection = module.get(GraphProjectionService);
    db = module.get(DatabaseService);
  });

  afterAll(async () => {
    await module.close();
    rmSync(projectDir, { recursive: true, force: true });
  });

  test("projecting a structured topic file writes title, summaries, sha and the user-edit flag", async () => {
    let path: string;
    let sha: string;
    let row: { title: string; short_summary: string; long_summary: string; source_sha: string; edited_by_user: boolean } | undefined;

    await given(
      "a structured topic file authored by the user (edited_by_user=true)",
      () => {
        path = topicJsonPath(projectDir, "t-projection");
        writeFileSync(
          path,
          JSON.stringify({
            id: "t-projection",
            title: "Strategy",
            short_summary: "short",
            long_summary: "long",
            items: [],
            edited_by_user: true,
          }),
        );
        sha = computeFileSha(path);
      },
    );
    await when("the projection service projects the topic into the graph", async () => {
      await projection.project({
        kind: "topic",
        ext: ".json",
        id: "t-projection",
        absPath: path,
        sha,
        editedByUser: true,
      });
    });
    await then("a Topic node carries every projected field plus the sha and edit flag", async () => {
      const rows = await db.query<{ title: string; short_summary: string; long_summary: string; source_sha: string; edited_by_user: boolean }>(
        "MATCH (t:Topic) WHERE t.id = $id RETURN t.title AS title, t.short_summary AS short_summary, t.long_summary AS long_summary, t.source_sha AS source_sha, t.edited_by_user AS edited_by_user",
        { id: "t-projection" },
      );
      row = rows[0];
      expect(row).toEqual({
        title: "Strategy",
        short_summary: "short",
        long_summary: "long",
        source_sha: sha,
        edited_by_user: true,
      });
    });
  });

  test("projecting a structured decision file writes title, status, sha, and edit flag", async () => {
    let path: string;
    let sha: string;

    await given("a structured decision file with status 'accepted'", () => {
      path = decisionJsonPath(projectDir, "d-projection");
      writeFileSync(
        path,
        JSON.stringify({
          id: "d-projection",
          topic_id: "t-projection",
          title: "Pick TS",
          status: "accepted",
          referenced_items: [],
          context: { text: "", supporting_item_indices: [] },
          decision: { text: "", rationale: "", supporting_item_indices: [] },
          alternative_options: [],
          edited_by_user: false,
        }),
      );
      sha = computeFileSha(path);
    });
    await when("the projection service projects the decision into the graph", async () => {
      await projection.project({
        kind: "decision",
        ext: ".json",
        id: "d-projection",
        absPath: path,
        sha,
        editedByUser: false,
      });
    });
    await then("a Decision node reflects the file contents", async () => {
      const rows = await db.query<{ title: string; status: string; source_sha: string; edited_by_user: boolean }>(
        "MATCH (d:Decision) WHERE d.id = $id RETURN d.title AS title, d.status AS status, d.source_sha AS source_sha, d.edited_by_user AS edited_by_user",
        { id: "d-projection" },
      );
      expect(rows[0]).toEqual({
        title: "Pick TS",
        status: "accepted",
        source_sha: sha,
        edited_by_user: false,
      });
    });
  });

  test("projecting a conversation markdown file records md_sha but no sidecar fields", async () => {
    let path: string;
    let sha: string;

    await given("a conversation md path with a freshly computed sha", () => {
      path = conversationJsonPath(projectDir, "c-md").replace(/\.json$/, ".md");
      writeFileSync(path, "<!-- conversation_id: c-md -->\n# hi\n");
      sha = computeFileSha(path);
    });
    await when("the projection service projects the markdown file", async () => {
      await projection.project({
        kind: "conversation",
        ext: ".md",
        id: "c-md",
        absPath: path,
        sha,
        editedByUser: false,
      });
    });
    await then("the Conversation node carries the md_sha", async () => {
      const rows = await db.query<{ md_sha: string }>(
        "MATCH (c:Conversation) WHERE c.id = $id RETURN c.md_sha AS md_sha",
        { id: "c-md" },
      );
      expect(rows[0]?.md_sha).toBe(sha);
    });
  });
});
