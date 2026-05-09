import "reflect-metadata";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { and, given, then, when } from "@tests/bdd.js";
import {
  clearGraphNew,
  createKnowledgeNewTestModule,
  type KnowledgeNewTestContext,
} from "@tests/helpers/knowledge-new-test-context.js";
import {
  TopicFileNewSchema,
  type TopicFileNew,
} from "@noesis/shared-contracts/source-file-schemas-new.js";
import { topicJsonPath } from "@noesis/shared-contracts/source-files.js";

function topicFile(overrides: Partial<TopicFileNew> = {}): TopicFileNew {
  return TopicFileNewSchema.parse({
    id: "topic-1",
    parent_id: null,
    title: "Auth",
    short_summary: "Auth scope",
    long_summary: "Authentication scope including login and signup.",
    items: [],
    reviewed: true,
    decisions_extracted: false,
    is_stale: false,
    ...overrides,
  });
}

function writeTopicFile(projectDir: string, file: TopicFileNew): string {
  const path = topicJsonPath(projectDir, file.id);
  mkdirSync(join(projectDir, "noesis", "topics"), { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 2));
  return path;
}

describe("TopicsServiceNew — index file, edit fields with locks, refresh stale flag", () => {
  let ctx: KnowledgeNewTestContext;

  beforeAll(async () => {
    ctx = await createKnowledgeNewTestModule();
  });

  afterAll(async () => {
    await ctx.module.close();
    rmSync(ctx.projectDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await clearGraphNew(ctx.db);
  });

  test("indexFile inserts a Topic row when no DB record exists for that id", async () => {
    let path = "";
    let outcome: { status: string; topic_id: string } | null = null;

    await given("a topic file present on disk", () => {
      path = writeTopicFile(ctx.projectDir, topicFile());
    });
    await when("the indexer processes the file", async () => {
      outcome = await ctx.topics.indexFile(path);
    });
    await then("the service reports it indexed the file", () => {
      expect(outcome?.status).toBe("indexed");
      expect(outcome?.topic_id).toBe("topic-1");
    });
    await and("the Topic node is persisted with the file's content", async () => {
      const stored = await ctx.topicsRepository.read("topic-1");
      expect(stored?.title).toBe("Auth");
      expect(stored?.short_summary).toBe("Auth scope");
      expect(stored?.long_summary).toBe(
        "Authentication scope including login and signup.",
      );
      expect(stored?.is_stale).toBe(false);
      expect(stored?.parent_id).toBeNull();
    });
  });

  test("indexFile is a no-op when stored hash matches the file hash", async () => {
    let path = "";
    let secondOutcome: { status: string } | null = null;

    await given("a topic indexed on the first pass", async () => {
      path = writeTopicFile(ctx.projectDir, topicFile());
      await ctx.topics.indexFile(path);
    });
    await when("the indexer processes the same file again without disk changes", async () => {
      secondOutcome = await ctx.topics.indexFile(path);
    });
    await then("the service reports the file as unchanged", () => {
      expect(secondOutcome?.status).toBe("unchanged");
    });
  });

  test("indexFile re-projects the Topic when the file has been modified on disk", async () => {
    let path = "";

    await given("a topic indexed once", async () => {
      path = writeTopicFile(ctx.projectDir, topicFile());
      await ctx.topics.indexFile(path);
    });
    await when("the file is rewritten with a new long_summary", async () => {
      writeTopicFile(
        ctx.projectDir,
        topicFile({ long_summary: "Updated authentication scope." }),
      );
      const outcome = await ctx.topics.indexFile(path);
      expect(outcome.status).toBe("indexed");
    });
    await then("the Topic node reflects the new long_summary", async () => {
      const stored = await ctx.topicsRepository.read("topic-1");
      expect(stored?.long_summary).toBe("Updated authentication scope.");
    });
  });

  test("editFields rewrites only the supplied editable fields and reports them", async () => {
    let path = "";
    let result: { updated: string[] } | null = null;

    await given("a topic indexed and present on disk", async () => {
      path = writeTopicFile(ctx.projectDir, topicFile());
      await ctx.topics.indexFile(path);
    });
    await when("the user edits the title only", async () => {
      result = await ctx.topics.editFields(
        "topic-1",
        { title: "Authentication" },
        false,
      );
    });
    await then("the service reports title as the only updated field", () => {
      expect(result?.updated).toEqual(["title"]);
    });
    await and("the file's title is written and lock fields stay false", () => {
      const file = TopicFileNewSchema.parse(
        JSON.parse(readFileSync(path, "utf-8")),
      );
      expect(file.title).toBe("Authentication");
      expect(file.short_summary).toBe("Auth scope");
      expect(file.title_locked).toBe(false);
      expect(file.short_summary_locked).toBe(false);
    });
  });

  test("editFields skips writing when the new value equals the current value", async () => {
    let path = "";
    let result: { updated: string[] } | null = null;
    let firstSnapshot = "";

    await given("a topic on disk with known content", async () => {
      path = writeTopicFile(ctx.projectDir, topicFile());
      await ctx.topics.indexFile(path);
      firstSnapshot = readFileSync(path, "utf-8");
    });
    await when("the user submits an edit identical to the current title", async () => {
      result = await ctx.topics.editFields(
        "topic-1",
        { title: "Auth" },
        false,
      );
    });
    await then("no field is reported as updated", () => {
      expect(result?.updated).toEqual([]);
    });
    await and("the file content is byte-identical to before the edit", () => {
      expect(readFileSync(path, "utf-8")).toBe(firstSnapshot);
    });
  });

  test("editFields rejects a write to a locked field when confirmedByUser is false", async () => {
    let path = "";
    let thrown: Error | null = null;

    await given("a topic whose title is locked by a prior user edit", async () => {
      path = writeTopicFile(
        ctx.projectDir,
        topicFile({ title: "Auth", title_locked: true }),
      );
      await ctx.topics.indexFile(path);
    });
    await when("a skill-driven update tries to overwrite the locked title", async () => {
      try {
        await ctx.topics.editFields(
          "topic-1",
          { title: "Different" },
          false,
        );
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the service refuses with a lock violation error", () => {
      expect(thrown).not.toBeNull();
      expect(thrown?.message).toContain("locked");
    });
    await and("the on-disk title remains unchanged", () => {
      const file = TopicFileNewSchema.parse(
        JSON.parse(readFileSync(path, "utf-8")),
      );
      expect(file.title).toBe("Auth");
    });
  });

  test("editFields overwrites a locked field when confirmedByUser is true", async () => {
    let path = "";
    let result: { updated: string[] } | null = null;

    await given("a topic whose long_summary is locked", async () => {
      path = writeTopicFile(
        ctx.projectDir,
        topicFile({
          long_summary: "Locked text",
          long_summary_locked: true,
        }),
      );
      await ctx.topics.indexFile(path);
    });
    await when("an update overrides the lock with explicit user confirmation", async () => {
      result = await ctx.topics.editFields(
        "topic-1",
        { long_summary: "Replacement text" },
        true,
      );
    });
    await then("long_summary is reported as updated", () => {
      expect(result?.updated).toEqual(["long_summary"]);
    });
    await and("the file's long_summary is rewritten", () => {
      const file = TopicFileNewSchema.parse(
        JSON.parse(readFileSync(path, "utf-8")),
      );
      expect(file.long_summary).toBe("Replacement text");
    });
  });

  test("refreshStaleFlags marks a topic stale when an item's source_sha differs from the snapshot", async () => {
    let path = "";

    await given("a topic referencing a conversation idea unit with known source_sha", async () => {
      path = writeTopicFile(
        ctx.projectDir,
        topicFile({
          items: [
            {
              type: "idea_unit_ref",
              conversation_id: "conv-1",
              turn_index: 0,
              idea_unit_index: 0,
              source_sha: "old-sha",
            },
          ],
        }),
      );
      await ctx.topics.indexFile(path);
    });

    let staleCount = 0;
    await when("the stale-flag pass runs with a newer conversation sha", async () => {
      staleCount = await ctx.topics.refreshStaleFlags({
        conversation: new Map([["conv-1", "new-sha"]]),
        document: new Map(),
      });
    });
    await then("the pass returns one stale topic", () => {
      expect(staleCount).toBe(1);
    });
    await and("the DB and the source file both record is_stale=true", async () => {
      const stored = await ctx.topicsRepository.read("topic-1");
      expect(stored?.is_stale).toBe(true);
      const file = TopicFileNewSchema.parse(
        JSON.parse(readFileSync(path, "utf-8")),
      );
      expect(file.is_stale).toBe(true);
    });
  });

  test("refreshStaleFlags clears is_stale when source shas no longer differ", async () => {
    let path = "";

    await given("a topic that was previously marked stale on disk", async () => {
      path = writeTopicFile(
        ctx.projectDir,
        topicFile({
          is_stale: true,
          items: [
            {
              type: "document_fragment_ref",
              document_id: "doc-1",
              start_offset: 0,
              end_offset: 5,
              source_sha: "matching-sha",
            },
          ],
        }),
      );
      await ctx.topics.indexFile(path);
    });

    await when("the stale-flag pass runs with a snapshot whose document sha matches", async () => {
      await ctx.topics.refreshStaleFlags({
        conversation: new Map(),
        document: new Map([["doc-1", "matching-sha"]]),
      });
    });
    await then("the topic is no longer stale in DB or on disk", async () => {
      const stored = await ctx.topicsRepository.read("topic-1");
      expect(stored?.is_stale).toBe(false);
      const file = TopicFileNewSchema.parse(
        JSON.parse(readFileSync(path, "utf-8")),
      );
      expect(file.is_stale).toBe(false);
    });
  });

  test("deleteForFile removes the Topic from DB when given the canonical file path", async () => {
    let path = "";

    await given("a topic indexed in DB", async () => {
      path = writeTopicFile(ctx.projectDir, topicFile());
      await ctx.topics.indexFile(path);
    });
    await when("deleteForFile is called for the same path", async () => {
      const result = await ctx.topics.deleteForFile(path);
      expect(result?.topic_id).toBe("topic-1");
    });
    await then("the Topic no longer exists in DB", async () => {
      expect(await ctx.topicsRepository.exists("topic-1")).toBe(false);
    });
  });

  test("canonicalPath produces the canonical topics/<id>.json path", () => {
    expect(ctx.topics.canonicalPath("topic-99")).toBe(
      `${ctx.projectDir}/noesis/topics/topic-99.json`,
    );
  });
});
