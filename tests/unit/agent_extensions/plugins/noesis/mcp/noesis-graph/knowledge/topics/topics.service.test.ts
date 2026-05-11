import "reflect-metadata";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { and, given, then, when } from "@tests/bdd.js";
import {
  clearGraphNew,
  createKnowledgeNewTestModule,
  type KnowledgeNewTestContext,
} from "@tests/helpers/knowledge-test-context.js";
import {
  TopicFileNewSchema,
  type TopicFileNew,
} from "@noesis/shared-contracts/source-file-schemas.js";
import {
  findTopicJsonById,
  topicJsonPath,
} from "@noesis/shared-contracts/source-files.js";

describe("TopicsService — indexing, editing with locks, staleness, deletion", () => {
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

  test("Indexing a brand-new topic file inserts the corresponding Topic row in DB", async () => {
    let path = "";
    let outcome: { status: string; topic_id: string } | null = null;

    await given("a topic file present on disk and no record in DB", () => {
      path = writeTopicFile(ctx.projectDir, topicFile());
    });
    await when("indexing the file", async () => {
      outcome = await ctx.topics.indexFile(path);
    });
    await then("the operation reports the topic as freshly indexed", () => {
      expect(outcome?.status).toBe("indexed");
      expect(outcome?.topic_id).toBe("topic-1");
    });
    await and("the persisted Topic carries every field from the file", async () => {
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

  test("Indexing the same topic file twice without disk changes is a no-op", async () => {
    let path = "";
    let secondOutcome: { status: string } | null = null;

    await given("a topic indexed once", async () => {
      path = writeTopicFile(ctx.projectDir, topicFile());
      await ctx.topics.indexFile(path);
    });
    await when("indexing the file a second time without any disk changes", async () => {
      secondOutcome = await ctx.topics.indexFile(path);
    });
    await then("the operation reports the topic as unchanged", () => {
      expect(secondOutcome?.status).toBe("unchanged");
    });
  });

  test("Indexing a topic whose file content drifted re-projects the changed fields into DB", async () => {
    let path = "";

    await given("a topic indexed once", async () => {
      path = writeTopicFile(ctx.projectDir, topicFile());
      await ctx.topics.indexFile(path);
    });
    await when("the file is rewritten with a new long summary and indexed again", async () => {
      writeTopicFile(
        ctx.projectDir,
        topicFile({ long_summary: "Updated authentication scope." }),
      );
      const outcome = await ctx.topics.indexFile(path);
      expect(outcome.status).toBe("indexed");
    });
    await then("the persisted Topic reflects the new long summary", async () => {
      const stored = await ctx.topicsRepository.read("topic-1");
      expect(stored?.long_summary).toBe("Updated authentication scope.");
    });
  });

  test("Editing a topic rewrites only the supplied fields and reports them as updated", async () => {
    let path = "";
    let result: { updated: string[] } | null = null;

    await given("a topic indexed and present on disk", async () => {
      path = writeTopicFile(ctx.projectDir, topicFile());
      await ctx.topics.indexFile(path);
    });
    await when("the user changes only the title", async () => {
      result = await ctx.topics.editFieldsAndLock(
        "topic-1",
        { title: "Authentication" },
        false,
      );
    });
    await then("title is the only field reported as updated", () => {
      expect(result?.updated).toEqual(["title"]);
    });
    await and("the new title is written to disk, its lock is set, and untouched fields keep their previous lock state", () => {
      const current = findTopicJsonById(ctx.projectDir, "topic-1");
      expect(current).not.toBeNull();
      const file = TopicFileNewSchema.parse(
        JSON.parse(readFileSync(current!, "utf-8")),
      );
      expect(file.title).toBe("Authentication");
      expect(file.short_summary).toBe("Auth scope");
      expect(file.title_locked).toBe(true);
      expect(file.short_summary_locked).toBe(false);
    });
    await and(
      "the old filename has been replaced with the slug derived from the new title",
      () => {
        expect(existsSync(path)).toBe(false);
        const current = findTopicJsonById(ctx.projectDir, "topic-1");
        expect(current).toBe(
          `${ctx.projectDir}/noesis/topics/authentication-topic1.json`,
        );
      },
    );
  });

  test("Editing a topic with a value identical to the stored one performs no write", async () => {
    let path = "";
    let result: { updated: string[] } | null = null;
    let firstSnapshot = "";

    await given("a topic on disk with known content", async () => {
      path = writeTopicFile(ctx.projectDir, topicFile());
      await ctx.topics.indexFile(path);
      firstSnapshot = readFileSync(path, "utf-8");
    });
    await when("the user submits a title equal to the current one", async () => {
      result = await ctx.topics.editFieldsAndLock(
        "topic-1",
        { title: "Auth" },
        false,
      );
    });
    await then("no field is reported as updated", () => {
      expect(result?.updated).toEqual([]);
    });
    await and("the file content is byte-identical to the original snapshot", () => {
      expect(readFileSync(path, "utf-8")).toBe(firstSnapshot);
    });
  });

  test("Editing a locked topic field without user confirmation is refused", async () => {
    let path = "";
    let thrown: Error | null = null;

    await given("a topic whose title was previously locked by the user", async () => {
      path = writeTopicFile(
        ctx.projectDir,
        topicFile({ title: "Auth", title_locked: true }),
      );
      await ctx.topics.indexFile(path);
    });
    await when("an edit tries to overwrite the locked title without confirmation", async () => {
      try {
        await ctx.topics.editFieldsAndLock(
          "topic-1",
          { title: "Different" },
          false,
        );
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the service refuses with a lock violation", () => {
      expect(thrown).not.toBeNull();
      expect(thrown?.message).toContain("locked");
    });
    await and("the on-disk title is unchanged", () => {
      const file = TopicFileNewSchema.parse(
        JSON.parse(readFileSync(path, "utf-8")),
      );
      expect(file.title).toBe("Auth");
    });
  });

  test("Editing a locked topic field with explicit user confirmation overwrites the value", async () => {
    let path = "";
    let result: { updated: string[] } | null = null;

    await given("a topic whose long summary is locked", async () => {
      path = writeTopicFile(
        ctx.projectDir,
        topicFile({
          long_summary: "Locked text",
          long_summary_locked: true,
        }),
      );
      await ctx.topics.indexFile(path);
    });
    await when("the user confirms an override and supplies a new long summary", async () => {
      result = await ctx.topics.editFieldsAndLock(
        "topic-1",
        { long_summary: "Replacement text" },
        true,
      );
    });
    await then("the long summary is reported as updated", () => {
      expect(result?.updated).toEqual(["long_summary"]);
    });
    await and("the file's long summary carries the replacement value", () => {
      const file = TopicFileNewSchema.parse(
        JSON.parse(readFileSync(path, "utf-8")),
      );
      expect(file.long_summary).toBe("Replacement text");
    });
  });

  test("Refreshing staleness marks a topic stale when a referenced source has drifted", async () => {
    let path = "";

    await given("a topic referencing a conversation idea unit with an outdated source sha", async () => {
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
    await when("staleness is refreshed against a snapshot with the conversation's new sha", async () => {
      staleCount = await ctx.topics.refreshStaleFlags({
        conversation: new Map([["conv-1", "new-sha"]]),
        document: new Map(),
      });
    });
    await then("the operation reports one topic as stale", () => {
      expect(staleCount).toBe(1);
    });
    await and("both the DB row and the source file record the topic as stale", async () => {
      const stored = await ctx.topicsRepository.read("topic-1");
      expect(stored?.is_stale).toBe(true);
      const file = TopicFileNewSchema.parse(
        JSON.parse(readFileSync(path, "utf-8")),
      );
      expect(file.is_stale).toBe(true);
    });
  });

  test("Refreshing staleness clears the stale flag once a topic's sources are back in sync", async () => {
    let path = "";

    await given("a topic previously marked stale while referencing a document fragment", async () => {
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

    await when("staleness is refreshed against a snapshot whose document sha matches the topic's", async () => {
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

  test("Deleting a topic while its source file is still on disk removes both the DB row and the file", async () => {
    let path = "";

    await given("an indexed topic whose source file still lives on disk", async () => {
      path = writeTopicFile(ctx.projectDir, topicFile());
      await ctx.topics.indexFile(path);
    });
    await when("deletion is requested for the topic's canonical path", async () => {
      const result = await ctx.topics.deleteForFile(path);
      expect(result?.topic_id).toBe("topic-1");
    });
    await then("the topic no longer exists in DB", async () => {
      expect(await ctx.topicsRepository.exists("topic-1")).toBe(false);
    });
    await and("the source file is removed from disk", () => {
      expect(existsSync(path)).toBe(false);
    });
  });

  test("Deleting a topic whose source file is already gone still removes the DB row", async () => {
    let path = "";

    await given("an indexed topic whose source file has been removed from disk", async () => {
      path = writeTopicFile(ctx.projectDir, topicFile());
      await ctx.topics.indexFile(path);
      rmSync(path, { force: true });
    });
    await when("deletion is requested for the topic's canonical path", async () => {
      const result = await ctx.topics.deleteForFile(path);
      expect(result?.topic_id).toBe("topic-1");
    });
    await then("the topic no longer exists in DB", async () => {
      expect(await ctx.topicsRepository.exists("topic-1")).toBe(false);
    });
  });

  test("The canonical topic path follows the noesis/topics/<slug>-<id-suffix>.json convention", () => {
    expect(ctx.topics.canonicalPath("topic-99", "Pricing review")).toBe(
      `${ctx.projectDir}/noesis/topics/pricing-review-topic99.json`,
    );
  });
});

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
  mkdirSync(join(projectDir, "noesis", "topics"), { recursive: true });
  const path = topicJsonPath(projectDir, file.id, file.title);
  writeFileSync(path, JSON.stringify(file, null, 2));
  return path;
}
