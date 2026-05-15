import "reflect-metadata";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdirSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { and, given, then, when } from "@tests/bdd.js";
import {
  clearGraphNew,
  createKnowledgeNewTestModule,
  type KnowledgeNewTestContext,
} from "@tests/helpers/knowledge-test-context.js";
import {
  ConversationSchema,
  type Conversation,
} from "@noesis/shared-contracts/conversation.js";
import {
  DecisionFileNewSchema,
  DocumentFileNewSchema,
  TopicFileNewSchema,
  type DecisionFileNew,
  type DocumentFileNew,
  type TopicFileNew,
} from "@noesis/shared-contracts/source-file-schemas.js";
import {
  conversationJsonPath,
  decisionJsonPath,
  designDocCanonicalPath,
  documentJsonPath,
  topicJsonPath,
} from "@noesis/shared-contracts/source-files.js";
import { DesignDocFileNewSchema, type DesignDocFileNew } from "@noesis/shared-contracts/design-doc-new.js";

describe("IndexerService — full-pass orchestration, deletion, staleness, single-flight", () => {
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
    ensureLayout(ctx.projectDir);
    for (const sub of ["conversations", "documents", "topics", "decisions", "design-docs"]) {
      const subDir = join(ctx.projectDir, "noesis", sub);
      for (const f of readdirSync(subDir)) {
        unlinkSync(join(subDir, f));
      }
    }
  });

  afterEach(() => {
    ctx.indexer.stopWatching();
  });

  test("Indexing an empty noesis dir reports zero processed and consistent state", async () => {
    let result: { files_total: number; files_processed: number } | null = null;

    await given("an empty noesis layout", () => {});
    await when("indexing is invoked", async () => {
      result = await ctx.indexer.runFullIndex();
    });
    await then("the result reports zero files and the state is consistent", () => {
      expect(result?.files_total).toBe(0);
      expect(result?.files_processed).toBe(0);
      expect(ctx.indexer.getState()).toBe("consistent");
    });
  });

  test("Indexing process every kind of source file present on disk", async () => {
    await given("one file per kind on disk", () => {
      writeJson(
        conversationJsonPath(ctx.projectDir, "conv-1", "Discussion"),
        makeConversationFile("conv-1"),
      );
      writeJson(
        documentJsonPath(ctx.projectDir, "doc-1", "Doc"),
        makeDocumentFile("doc-1"),
      );
      writeJson(
        topicJsonPath(ctx.projectDir, "topic-1", "Topic"),
        makeTopicFile("topic-1"),
      );
      writeJson(
        decisionJsonPath(ctx.projectDir, "decision-1", "Decision"),
        makeDecisionFile("decision-1"),
      );
    });
    let result: { files_processed: number } | null = null;
    await when("indexing is invoked", async () => {
      result = await ctx.indexer.runFullIndex();
    });
    await then("all four files are processed", () => {
      expect(result?.files_processed).toBe(4);
    });
    await and("each domain concept has the row in DB", async () => {
      expect(await ctx.conversationsRepository.exists("conv-1")).toBe(true);
      expect(await ctx.documentsRepository.exists("doc-1")).toBe(true);
      expect(await ctx.topicsRepository.exists("topic-1")).toBe(true);
      expect(await ctx.decisionsRepository.exists("decision-1")).toBe(true);
    });
  });

  test("Indexing deletes DB rows for files that have disappeared on disk", async () => {
    await given("a topic indexed once", async () => {
      writeJson(
        topicJsonPath(ctx.projectDir, "topic-1", "Topic"),
        makeTopicFile("topic-1"),
      );
      await ctx.indexer.runFullIndex();
      expect(await ctx.topicsRepository.exists("topic-1")).toBe(true);
    });
    await when("the file is removed and indexing runs again", async () => {
      unlinkSync(topicJsonPath(ctx.projectDir, "topic-1", "Topic"));
      const result = await ctx.indexer.runFullIndex();
      expect(result.files_deleted).toBe(1);
    });
    await then("the Topic row is no longer in DB", async () => {
      expect(await ctx.topicsRepository.exists("topic-1")).toBe(false);
    });
  });

  test("Indexing mark a topic as stale when its referenced conversation has changed sha", async () => {
    await given("a conversation indexed and a topic referencing it", async () => {
      writeJson(conversationJsonPath(ctx.projectDir, "conv-1", "Discussion"), makeConversationFile("conv-1"));
      writeJson(
        topicJsonPath(ctx.projectDir, "topic-1", "Topic"),
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
        })
      );
      await ctx.indexer.runFullIndex();
    });
    await when("indexing is invoked", async () => {
      await ctx.indexer.runFullIndex();
    });
    await then("the topic is marked stale because the conversation sha differs", async () => {
      const stored = await ctx.topicsRepository.read("topic-1");
      expect(stored?.is_stale).toBe(true);
    });
  });

  test("Indexing mark a decision as stale when its referenced conversation has changed sha", async () => {
    await given("a conversation indexed and a decision referencing it", async () => {
      writeJson(conversationJsonPath(ctx.projectDir, "conv-1", "Discussion"), makeConversationFile("conv-1"));
      writeJson(
        decisionJsonPath(ctx.projectDir, "decision-1", "Decision"),
        makeDecisionFile("decision-1", {
          referenced_items: [
            {
              type: "idea_unit_ref",
              conversation_id: "conv-1",
              turn_index: 0,
              idea_unit_index: 0,
              source_sha: "stale-sha",
            },
          ],
        })
      );
      await ctx.indexer.runFullIndex();
    });
    await when("indexing is invoked", async () => {
      await ctx.indexer.runFullIndex();
    });
    await then("the decision is marked stale because the conversation sha differs", async () => {
      const stored = await ctx.decisionsRepository.read("decision-1");
      expect(stored?.is_stale).toBe(true);
    });
  });

  test("Indexing preserves every kind of data across passes when files are unchanged", async () => {
    let conversationBefore: Awaited<ReturnType<typeof ctx.conversationsRepository.read>> = null;
    let documentBefore: Awaited<ReturnType<typeof ctx.documentsRepository.read>> = null;
    let topicBefore: Awaited<ReturnType<typeof ctx.topicsRepository.read>> = null;
    let decisionBefore: Awaited<ReturnType<typeof ctx.decisionsRepository.read>> = null;

    await given("one file per kind indexed once", async () => {
      writeJson(conversationJsonPath(ctx.projectDir, "conv-1", "Discussion"), makeConversationFile("conv-1"));
      writeJson(documentJsonPath(ctx.projectDir, "doc-1", "Doc"), makeDocumentFile("doc-1"));
      writeJson(topicJsonPath(ctx.projectDir, "topic-1", "Topic"), makeTopicFile("topic-1"));
      writeJson(decisionJsonPath(ctx.projectDir, "decision-1", "Decision"), makeDecisionFile("decision-1"));
      await ctx.indexer.runFullIndex();
      conversationBefore = await ctx.conversationsRepository.read("conv-1");
      documentBefore = await ctx.documentsRepository.read("doc-1");
      topicBefore = await ctx.topicsRepository.read("topic-1");
      decisionBefore = await ctx.decisionsRepository.read("decision-1");
    });
    await when("indexing is invoked again with no disk changes", async () => {
      const result = await ctx.indexer.runFullIndex();
      expect(result.files_processed).toBe(4);
      expect(result.files_deleted).toBe(0);
    });
    await then("the conversation row is identical to the snapshot taken before re-indexing", async () => {
      expect(await ctx.conversationsRepository.read("conv-1")).toEqual(conversationBefore);
    });
    await and("the document row is identical to the snapshot taken before re-indexing", async () => {
      expect(await ctx.documentsRepository.read("doc-1")).toEqual(documentBefore);
    });
    await and("the topic row is identical to the snapshot taken before re-indexing", async () => {
      expect(await ctx.topicsRepository.read("topic-1")).toEqual(topicBefore);
    });
    await and("the decision row is identical to the snapshot taken before re-indexing", async () => {
      expect(await ctx.decisionsRepository.read("decision-1")).toEqual(decisionBefore);
    });
  });

  test("Indexing reports an indexing status while a pass is running and while a re-run is queued", async () => {
    let stateDuringFirstPass: string | null = null;
    let stateAfterQueuingSecondPass: string | null = null;
    let stateAfterEverythingDrains: string | null = null;

    await given("a conversation file on disk", () => {
      writeJson(conversationJsonPath(ctx.projectDir, "conv-1", "Discussion"), makeConversationFile("conv-1"));
    });
    await when("a pass is started and a second one is queued before either completes", async () => {
      const first = ctx.indexer.runFullIndex();
      stateDuringFirstPass = ctx.indexer.getState();
      const second = ctx.indexer.runFullIndex();
      stateAfterQueuingSecondPass = ctx.indexer.getState();
      await Promise.all([first, second]);
      stateAfterEverythingDrains = ctx.indexer.getState();
    });
    await then("the status reads as indexing while the first pass runs", () => {
      expect(stateDuringFirstPass).toBe("indexing");
    });
    await and("the status keeps reading as indexing once a follow-up is queued", () => {
      expect(stateAfterQueuingSecondPass).toBe("indexing");
    });
    await and("the status settles to consistent after both slots drain", () => {
      expect(stateAfterEverythingDrains).toBe("consistent");
    });
  });

  test("Indexing called twice concurrently yields a single executing pass plus one queued rerun", async () => {
    await given("a conversation file on disk", () => {
      writeJson(
        conversationJsonPath(ctx.projectDir, "conv-1", "Discussion"),
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

  test("Indexing requests arriving during an in-flight pass collapse into a single shared follow-up", async () => {
    let firstResult: unknown = null;
    let secondResult: unknown = null;
    let thirdResult: unknown = null;

    await given("a conversation file on disk", () => {
      writeJson(conversationJsonPath(ctx.projectDir, "conv-1", "Discussion"), makeConversationFile("conv-1"));
    });
    await when("three indexing requests are issued back-to-back", async () => {
      const p1 = ctx.indexer.runFullIndex();
      const p2 = ctx.indexer.runFullIndex();
      const p3 = ctx.indexer.runFullIndex();
      [firstResult, secondResult, thirdResult] = await Promise.all([p1, p2, p3]);
    });
    await then("the second and third callers observe the same queued follow-up", () => {
      expect(secondResult).toBe(thirdResult);
    });
    await and("the first caller observes the original in-flight pass", () => {
      expect(firstResult).not.toBe(secondResult);
    });
  });

  test("Indexing is triggered automatically by changes to source files when watching is enabled", async () => {
    await given("the indexer is watching the project layout", () => {
      ctx.indexer.startWatching();
    });
    await when("a new conversation file appears on disk", async () => {
      writeJson(conversationJsonPath(ctx.projectDir, "conv-1", "Discussion"), makeConversationFile("conv-1"));
      await waitForCondition(
        async () =>
          ctx.indexer.getState() === "consistent" &&
          (await ctx.conversationsRepository.exists("conv-1")),
      );
    });
    await then("the conversation reaches DB without any explicit indexing call", async () => {
      expect(await ctx.conversationsRepository.exists("conv-1")).toBe(true);
    });
  });

  test("Indexing ignores stray .md files placed in documents and conversations subdirs", async () => {
    await given("stray .md files in the noesis layout that are not source files", () => {
      writeFileSync(
        join(ctx.projectDir, "noesis", "documents", "draft.md"),
        "# Some draft\n\nNot a JSON document.\n",
      );
      writeFileSync(
        join(ctx.projectDir, "noesis", "conversations", "transcript.md"),
        "# Conversation transcript\n",
      );
    });
    let result:
      | { files_total: number; files_processed: number }
      | null = null;
    await when("indexing runs", async () => {
      result = await ctx.indexer.runFullIndex();
    });
    await then("the indexer ignores the .md files entirely and stays in a consistent state", () => {
      expect(ctx.indexer.getState()).toBe("consistent");
      expect(result?.files_total).toBe(0);
      expect(result?.files_processed).toBe(0);
    });
  });

  test("Indexing picks up a file in a subdirectory that was removed and recreated (git-checkout regression)", async () => {
    const designDoc: DesignDocFileNew = DesignDocFileNewSchema.parse({
      id: "f9cb90cc-0ec6-4c1a-bb9f-c600ba3b490a",
      name: "Sample",
      description: "Reproduction fixture for git-checkout reindex bug.",
      date: "2026-05-09",
      actors: [],
      implemented: false,
    });
    const designDocsDir = join(ctx.projectDir, "noesis", "design-docs");

    await given("the indexer is watching the project layout", () => {
      ctx.indexer.startWatching();
    });
    await and("a design doc file is indexed once", async () => {
      writeJson(
        designDocCanonicalPath(ctx.projectDir, designDoc.id, designDoc.name),
        designDoc,
      );
      await waitForCondition(
        async () =>
          ctx.indexer.getState() === "consistent" &&
          (await ctx.designDocsRepository.exists(designDoc.id)),
      );
    });
    await when(
      "the design-docs subdirectory is deleted and then recreated with the file (mimicking git checkout away and back)",
      async () => {
        rmSync(designDocsDir, { recursive: true, force: true });
        await waitForCondition(
          async () =>
            ctx.indexer.getState() === "consistent" &&
            !(await ctx.designDocsRepository.exists(designDoc.id)),
        );
        mkdirSync(designDocsDir, { recursive: true });
        writeJson(
          designDocCanonicalPath(ctx.projectDir, designDoc.id, designDoc.name),
          designDoc,
        );
        await waitForCondition(
          async () =>
            ctx.indexer.getState() === "consistent" &&
            (await ctx.designDocsRepository.exists(designDoc.id)),
        );
      },
    );
    await then("the design doc reaches DB without any explicit indexing call", async () => {
      expect(await ctx.designDocsRepository.exists(designDoc.id)).toBe(true);
    });
  });

  test("Indexing absorbs a rapid burst of file changes and lands every change in DB", async () => {
    await given("the indexer is watching the project layout", () => {
      ctx.indexer.startWatching();
    });
    await when("conversations are added one after another in quick succession", async () => {
      writeJson(conversationJsonPath(ctx.projectDir, "conv-1", "Discussion"), makeConversationFile("conv-1"));
      await waitForCondition(
        async () =>
          ctx.indexer.getState() === "consistent" &&
          (await ctx.conversationsRepository.exists("conv-1")),
      );
      writeJson(conversationJsonPath(ctx.projectDir, "conv-2", "Discussion"), makeConversationFile("conv-2"));
      await waitForCondition(
        async () =>
          ctx.indexer.getState() === "consistent" &&
          (await ctx.conversationsRepository.exists("conv-2")),
      );
      writeJson(conversationJsonPath(ctx.projectDir, "conv-3", "Discussion"), makeConversationFile("conv-3"));
      await waitForCondition(
        async () =>
          ctx.indexer.getState() === "consistent" &&
          (await ctx.conversationsRepository.exists("conv-3")),
      );
    });
    await then("all three conversations are present in DB", async () => {
      expect(await ctx.conversationsRepository.exists("conv-1")).toBe(true);
      expect(await ctx.conversationsRepository.exists("conv-2")).toBe(true);
      expect(await ctx.conversationsRepository.exists("conv-3")).toBe(true);
    });
  });
});

function makeConversationFile(id: string): Conversation {
  return ConversationSchema.parse({
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

function makeTopicFile(id: string, overrides: Partial<TopicFileNew> = {}): TopicFileNew {
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

function makeDecisionFile(id: string, overrides: Partial<DecisionFileNew> = {}): DecisionFileNew {
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

async function waitForCondition(
  predicate: () => Promise<boolean>,
  timeoutMs = 5000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Condition not met within timeout");
}
