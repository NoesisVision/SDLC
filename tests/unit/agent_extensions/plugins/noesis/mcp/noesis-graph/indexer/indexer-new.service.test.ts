import "reflect-metadata";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { and, given, then, when } from "@tests/bdd.js";
import {
  clearGraphNew,
  createKnowledgeNewTestModule,
  type KnowledgeNewTestContext,
} from "@tests/helpers/knowledge-new-test-context.js";
import {
  ConversationFileNewSchema,
  DecisionFileNewSchema,
  DocumentFileNewSchema,
  TopicFileNewSchema,
  type ConversationFileNew,
  type DecisionFileNew,
  type DocumentFileNew,
  type TopicFileNew,
} from "@noesis/shared-contracts/source-file-schemas-new.js";
import {
  conversationJsonPath,
  decisionJsonPath,
  documentJsonPath,
  topicJsonPath,
} from "@noesis/shared-contracts/source-files.js";

function makeConversationFile(id: string): ConversationFileNew {
  return ConversationFileNewSchema.parse({
    conversation_id: id,
    time: "2026-04-17T10:00:00Z",
    main_topic: "Discussion",
    turns: [
      {
        index: 0,
        speaker: "alice",
        time: "2026-04-17T10:00:00Z",
        idea_units: [
          {
            index: 0,
            sentences: ["Hello world"],
            categories: ["Information"],
          },
        ],
      },
    ],
  });
}

function makeDocumentFile(id: string): DocumentFileNew {
  return DocumentFileNewSchema.parse({
    document_id: id,
    title: "Doc",
    date: "2026-04-17",
    content: "Hello.",
    fragments: [
      {
        index: 0,
        start_offset: 0,
        end_offset: 6,
        section_path: [],
        kind: "paragraph",
        text: "Hello.",
        categories: ["Information"],
      },
    ],
    section_tree: [],
  });
}

function makeTopicFile(
  id: string,
  overrides: Partial<TopicFileNew> = {},
): TopicFileNew {
  return TopicFileNewSchema.parse({
    id,
    parent_id: null,
    title: "Topic",
    short_summary: "Short.",
    long_summary: "Long summary.",
    items: [],
    reviewed: true,
    decisions_extracted: false,
    is_stale: false,
    ...overrides,
  });
}

function makeDecisionFile(
  id: string,
  overrides: Partial<DecisionFileNew> = {},
): DecisionFileNew {
  return DecisionFileNewSchema.parse({
    id,
    topic_id: "topic-1",
    title: "Decision",
    status: "accepted",
    referenced_items: [],
    context: { text: "ctx", supporting_item_indices: [] },
    decision: { text: "dec", rationale: "r", supporting_item_indices: [] },
    alternative_options: [],
    is_stale: false,
    ...overrides,
  });
}

function ensureLayout(projectDir: string): void {
  for (const sub of ["conversations", "documents", "topics", "decisions", "design-docs"]) {
    mkdirSync(join(projectDir, "noesis", sub), { recursive: true });
  }
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

describe("IndexerServiceNew — full-pass orchestration, deletion, staleness, single-flight", () => {
  let ctx: KnowledgeNewTestContext;

  beforeAll(async () => {
    ctx = await createKnowledgeNewTestModule();
    ctx.indexer.setDebounceMs(20);
  });

  afterAll(async () => {
    ctx.indexer.stopWatching();
    await ctx.module.close();
    rmSync(ctx.projectDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await clearGraphNew(ctx.db);
    rmSync(join(ctx.projectDir, "noesis"), { recursive: true, force: true });
    ensureLayout(ctx.projectDir);
  });

  test("runFullIndex on an empty noesis dir reports zero processed and consistent state", async () => {
    let result: { files_total: number; files_processed: number } | null = null;

    await given("an empty noesis layout", () => {});
    await when("runFullIndex is invoked", async () => {
      result = await ctx.indexer.runFullIndex();
    });
    await then("the result reports zero files and the state is consistent", () => {
      expect(result?.files_total).toBe(0);
      expect(result?.files_processed).toBe(0);
      expect(ctx.indexer.getState()).toBe("consistent");
    });
  });

  test("runFullIndex projects every kind of source file present on disk", async () => {
    await given("one file per kind on disk", () => {
      writeJson(
        conversationJsonPath(ctx.projectDir, "conv-1"),
        makeConversationFile("conv-1"),
      );
      writeJson(
        documentJsonPath(ctx.projectDir, "doc-1"),
        makeDocumentFile("doc-1"),
      );
      writeJson(
        topicJsonPath(ctx.projectDir, "topic-1"),
        makeTopicFile("topic-1"),
      );
      writeJson(
        decisionJsonPath(ctx.projectDir, "decision-1"),
        makeDecisionFile("decision-1"),
      );
    });
    let result: { files_processed: number } | null = null;
    await when("runFullIndex runs", async () => {
      result = await ctx.indexer.runFullIndex();
    });
    await then("all four files are processed", () => {
      expect(result?.files_processed).toBe(4);
    });
    await and("each domain has the row in DB", async () => {
      expect(await ctx.conversationsRepository.exists("conv-1")).toBe(true);
      expect(await ctx.documentsRepository.exists("doc-1")).toBe(true);
      expect(await ctx.topicsRepository.exists("topic-1")).toBe(true);
      expect(await ctx.decisionsRepository.exists("decision-1")).toBe(true);
    });
  });

  test("runFullIndex deletes DB rows for files that have disappeared on disk", async () => {
    await given("a topic indexed once", async () => {
      writeJson(
        topicJsonPath(ctx.projectDir, "topic-1"),
        makeTopicFile("topic-1"),
      );
      await ctx.indexer.runFullIndex();
      expect(await ctx.topicsRepository.exists("topic-1")).toBe(true);
    });
    await when("the file is removed and runFullIndex runs again", async () => {
      unlinkSync(topicJsonPath(ctx.projectDir, "topic-1"));
      const result = await ctx.indexer.runFullIndex();
      expect(result.files_deleted).toBe(1);
    });
    await then("the Topic row is no longer in DB", async () => {
      expect(await ctx.topicsRepository.exists("topic-1")).toBe(false);
    });
  });

  test("runFullIndex flips a topic's is_stale to true when its referenced conversation has changed sha", async () => {
    await given("a conversation indexed and a topic with old source_sha for it", async () => {
      writeJson(
        conversationJsonPath(ctx.projectDir, "conv-1"),
        makeConversationFile("conv-1"),
      );
      writeJson(
        topicJsonPath(ctx.projectDir, "topic-1"),
        makeTopicFile("topic-1", {
          items: [
            {
              type: "idea_unit_ref",
              conversation_id: "conv-1",
              turn_index: 0,
              idea_unit_index: 0,
              source_sha: "stale-sha",
            },
          ],
        }),
      );
      await ctx.indexer.runFullIndex();
    });
    await when("we read back the topic's is_stale", async () => {});
    await then("the topic is marked stale because the conversation sha differs", async () => {
      const stored = await ctx.topicsRepository.read("topic-1");
      expect(stored?.is_stale).toBe(true);
    });
  });

  test("runFullIndex preserves Conversation/Document data across passes when files are unchanged", async () => {
    await given("a conversation indexed once", async () => {
      writeJson(
        conversationJsonPath(ctx.projectDir, "conv-1"),
        makeConversationFile("conv-1"),
      );
      await ctx.indexer.runFullIndex();
    });
    await when("runFullIndex runs again with no disk changes", async () => {
      const result = await ctx.indexer.runFullIndex();
      expect(result.files_processed).toBe(1);
      expect(result.files_deleted).toBe(0);
    });
    await then("the conversation main_topic is unchanged", async () => {
      const stored = await ctx.conversationsRepository.read("conv-1");
      expect(stored?.main_topic).toBe("Discussion");
    });
  });

  test("runFullIndex called twice concurrently yields a single executing pass plus one queued rerun", async () => {
    await given("a conversation file on disk", () => {
      writeJson(
        conversationJsonPath(ctx.projectDir, "conv-1"),
        makeConversationFile("conv-1"),
      );
    });
    let firstResult: { files_processed: number } | null = null;
    let secondResult: { files_processed: number } | null = null;
    await when("two runFullIndex callers race", async () => {
      const p1 = ctx.indexer.runFullIndex();
      const p2 = ctx.indexer.runFullIndex();
      [firstResult, secondResult] = await Promise.all([p1, p2]);
    });
    await then("both callers observe a result with the file counted", () => {
      expect(firstResult?.files_processed).toBe(1);
      expect(secondResult?.files_processed).toBe(1);
    });
  });
});
