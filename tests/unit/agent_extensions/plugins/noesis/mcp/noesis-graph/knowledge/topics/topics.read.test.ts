import "reflect-metadata";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
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
  DocumentFileNewSchema,
  TopicFileNewSchema,
  type DocumentFileNew,
  type TopicFileNew,
} from "@noesis/shared-contracts/source-file-schemas.js";
import {
  conversationJsonPath,
  documentJsonPath,
  topicJsonPath,
} from "@noesis/shared-contracts/source-files.js";

describe("TopicsService — paginated reads, lookups, lineage and cross-domain projection", () => {
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
    rmSync(join(ctx.projectDir, "noesis"), { recursive: true, force: true });
  });

  test("Generating topic ids returns the requested count of distinct identifiers", () => {
    const result = ctx.topics.generateTopicIds(5);
    expect(result.ids).toHaveLength(5);
    expect(new Set(result.ids).size).toBe(5);
  });

  test("Generating topic ids rejects counts outside the supported range", () => {
    expect(() => ctx.topics.generateTopicIds(0)).toThrow(/between 1 and 50/);
    expect(() => ctx.topics.generateTopicIds(51)).toThrow(/between 1 and 50/);
    expect(() => ctx.topics.generateTopicIds(1.5)).toThrow(/between 1 and 50/);
  });

  test("Reading a topic returns its head fields together with the full ancestor path", async () => {
    let detail: { path: string[]; title: string } | null = null;

    await given(
      "a three-level topic tree with grandchild 'OAuth' under 'Auth' under 'Security'",
      async () => {
        await indexTopic(ctx, topicFile({ id: "security", title: "Security" }));
        await indexTopic(
          ctx,
          topicFile({ id: "auth", title: "Auth", parent_id: "security" }),
        );
        await indexTopic(
          ctx,
          topicFile({ id: "oauth", title: "OAuth", parent_id: "auth" }),
        );
      },
    );
    await when("reading the leaf topic", async () => {
      detail = await ctx.topics.readTopic("oauth");
    });
    await then(
      "the path traces every ancestor's title from root to leaf",
      () => {
        expect(detail?.path).toEqual(["Security", "Auth", "OAuth"]);
        expect(detail?.title).toBe("OAuth");
      },
    );
  });

  test("Reading a missing topic returns null without throwing", async () => {
    expect(await ctx.topics.readTopic("ghost")).toBeNull();
  });

  test("Listing root topics returns only those without a parent and flags whether each has subtopics", async () => {
    let overviews: Array<{ id: string; has_subtopics: boolean }> | null = null;

    await given("a root topic with one child and a sibling root with no children", async () => {
      await indexTopic(ctx, topicFile({ id: "root-a", title: "Alpha" }));
      await indexTopic(
        ctx,
        topicFile({ id: "child-a", title: "Alpha child", parent_id: "root-a" }),
      );
      await indexTopic(ctx, topicFile({ id: "root-b", title: "Beta" }));
    });
    await when("listing topics with a null parent", async () => {
      overviews = await ctx.topics.listTopics(null);
    });
    await then("the result lists only the two roots in title order", () => {
      expect(overviews?.map((o) => o.id)).toEqual(["root-a", "root-b"]);
    });
    await and("the parent root is reported as having subtopics, the leaf root is not", () => {
      const byId = new Map(overviews?.map((o) => [o.id, o.has_subtopics]));
      expect(byId.get("root-a")).toBe(true);
      expect(byId.get("root-b")).toBe(false);
    });
  });

  test("Listing children of a parent returns only its direct subtopics", async () => {
    let ids: string[] | null = null;

    await given("a parent with two direct children and one grandchild", async () => {
      await indexTopic(ctx, topicFile({ id: "p", title: "Parent" }));
      await indexTopic(ctx, topicFile({ id: "c1", title: "Child One", parent_id: "p" }));
      await indexTopic(ctx, topicFile({ id: "c2", title: "Child Two", parent_id: "p" }));
      await indexTopic(ctx, topicFile({ id: "g", title: "Grand", parent_id: "c1" }));
    });
    await when("listing children of the parent", async () => {
      const children = await ctx.topics.listTopics("p");
      ids = children.map((c) => c.id);
    });
    await then("only direct children are returned, not the grandchild", () => {
      expect(ids).toEqual(["c1", "c2"]);
    });
  });

  test("The topics page projects each topic with its referenced conversations and documents", async () => {
    let page: Awaited<ReturnType<typeof ctx.topics.getTopicsPage>> | null = null;

    await given(
      "a topic 'Auth' linked to one conversation and one document, plus an unrelated topic",
      async () => {
        await indexConversation(ctx, conversationFile({ conversation_id: "conv-1" }));
        await indexDocument(ctx, documentFile({ document_id: "doc-1" }));
        await indexTopic(
          ctx,
          topicFile({
            id: "auth",
            title: "Auth",
            items: [
              {
                type: "idea_unit_ref",
                conversation_id: "conv-1",
                turn_index: 0,
                idea_unit_index: 0,
              },
              {
                type: "document_fragment_ref",
                document_id: "doc-1",
                start_offset: 0,
                end_offset: 5,
              },
            ],
          }),
        );
        await indexTopic(ctx, topicFile({ id: "other", title: "Other" }));
      },
    );
    await when("requesting the topics page", async () => {
      page = await ctx.topics.getTopicsPage();
    });
    await then("the linked topic carries the conversation and document refs", () => {
      const auth = page?.topics.find((t) => t.id === "auth");
      expect(auth?.conversations).toEqual([
        { conversation_id: "conv-1", title: "Project kickoff", date: "2026-01-01T10:00:00Z" },
      ]);
      expect(auth?.documents).toEqual([
        { document_id: "doc-1", title: "Vision", date: "2026-01-02" },
      ]);
    });
    await and("the unrelated topic carries no refs", () => {
      const other = page?.topics.find((t) => t.id === "other");
      expect(other?.conversations).toEqual([]);
      expect(other?.documents).toEqual([]);
    });
  });

  test("The topics page nests subtopics under their parent in the forest", async () => {
    let page: Awaited<ReturnType<typeof ctx.topics.getTopicsPage>> | null = null;

    await given("a parent topic 'Alpha' with a child 'Beta'", async () => {
      await indexTopic(ctx, topicFile({ id: "alpha", title: "Alpha" }));
      await indexTopic(
        ctx,
        topicFile({ id: "beta", title: "Beta", parent_id: "alpha" }),
      );
    });
    await when("requesting the topics page", async () => {
      page = await ctx.topics.getTopicsPage();
    });
    await then("only the parent appears at the root with the child nested inside", () => {
      expect(page?.topics).toHaveLength(1);
      const alpha = page!.topics[0];
      expect(alpha.id).toBe("alpha");
      expect(alpha.subtopics.map((s) => s.id)).toEqual(["beta"]);
    });
  });

  test("A topic with any locked field is reported as edited_by_user on the topics page", async () => {
    let page: Awaited<ReturnType<typeof ctx.topics.getTopicsPage>> | null = null;

    await given("two topics, one with a locked title", async () => {
      await indexTopic(
        ctx,
        topicFile({ id: "locked", title: "Locked", title_locked: true }),
      );
      await indexTopic(ctx, topicFile({ id: "open", title: "Open" }));
    });
    await when("requesting the topics page", async () => {
      page = await ctx.topics.getTopicsPage();
    });
    await then("only the topic with locks is flagged as edited", () => {
      const byId = new Map(page!.topics.map((t) => [t.id, t.edited_by_user]));
      expect(byId.get("locked")).toBe(true);
      expect(byId.get("open")).toBe(false);
    });
  });

  test("Topic-conversation detail returns only idea units cited by that topic for that conversation", async () => {
    let detail: Awaited<
      ReturnType<typeof ctx.topics.getTopicConversationDetail>
    > | null = null;

    await given(
      "a conversation with three idea units, only two of which are cited by topic 'Auth'",
      async () => {
        await indexConversation(
          ctx,
          conversationFile({
            conversation_id: "conv-1",
            turns: [
              {
                index: 0,
                speaker: "Alice",
                time: "2026-01-01T10:00:00Z",
                idea_units: [
                  { index: 0, sentences: ["First."], categories: ["Information"] },
                  { index: 1, sentences: ["Second."], categories: ["Position"] },
                  { index: 2, sentences: ["Third."], categories: ["Argument"] },
                ],
              },
            ],
          }),
        );
        await indexTopic(
          ctx,
          topicFile({
            id: "auth",
            title: "Auth",
            items: [
              {
                type: "idea_unit_ref",
                conversation_id: "conv-1",
                turn_index: 0,
                idea_unit_index: 0,
              },
              {
                type: "idea_unit_ref",
                conversation_id: "conv-1",
                turn_index: 0,
                idea_unit_index: 2,
              },
            ],
          }),
        );
      },
    );
    await when("requesting the topic-conversation detail", async () => {
      detail = await ctx.topics.getTopicConversationDetail("auth", "conv-1");
    });
    await then(
      "only the two cited idea units are returned with their full content",
      () => {
        expect(detail?.idea_units.map((iu) => iu.idea_unit_index)).toEqual([0, 2]);
        expect(detail?.idea_units[0].sentences).toEqual(["First."]);
        expect(detail?.idea_units[1].sentences).toEqual(["Third."]);
      },
    );
  });

  test("Topic-conversation detail rejects a conversation that is not referenced by the topic", async () => {
    let thrown: Error | null = null;

    await given("a topic that does not reference 'conv-x'", async () => {
      await indexConversation(ctx, conversationFile({ conversation_id: "conv-x" }));
      await indexTopic(ctx, topicFile({ id: "auth", title: "Auth" }));
    });
    await when("the detail endpoint is called for that conversation", async () => {
      try {
        await ctx.topics.getTopicConversationDetail("auth", "conv-x");
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the service refuses with 'not linked' and exposes both ids", () => {
      expect(thrown?.message).toContain("not linked");
      expect(thrown?.message).toContain("conv-x");
      expect(thrown?.message).toContain("auth");
    });
  });

  test("Topic-document detail slices each fragment text from the document content using its offsets", async () => {
    let detail: Awaited<
      ReturnType<typeof ctx.topics.getTopicDocumentDetail>
    > | null = null;

    await given("a document with content 'Hello world!' and a topic citing two ranges", async () => {
      await indexDocument(
        ctx,
        documentFile({
          document_id: "doc-1",
          content: "Hello world!",
          fragments: [
            { kind: "paragraph", index: 0, start_offset: 0, end_offset: 5, section_path: [], text: "Hello" },
            { kind: "paragraph", index: 1, start_offset: 6, end_offset: 11, section_path: [], text: "world" },
          ],
        }),
      );
      await indexTopic(
        ctx,
        topicFile({
          id: "topic-1",
          title: "Greeting",
          items: [
            {
              type: "document_fragment_ref",
              document_id: "doc-1",
              start_offset: 0,
              end_offset: 5,
            },
            {
              type: "document_fragment_ref",
              document_id: "doc-1",
              start_offset: 6,
              end_offset: 11,
            },
          ],
        }),
      );
    });
    await when("requesting the topic-document detail", async () => {
      detail = await ctx.topics.getTopicDocumentDetail("topic-1", "doc-1");
    });
    await then("each fragment's text is the document content sliced by its offsets", () => {
      expect(detail?.fragments).toEqual([
        { start_offset: 0, end_offset: 5, text: "Hello" },
        { start_offset: 6, end_offset: 11, text: "world" },
      ]);
    });
  });

  test("Topic items since a date include only items from sources newer than that date", async () => {
    let entries: Awaited<ReturnType<typeof ctx.topics.listTopicItemsSince>> | null = null;

    await given(
      "a topic citing one idea unit from a January conversation and one from a March conversation",
      async () => {
        await indexConversation(
          ctx,
          conversationFile({
            conversation_id: "conv-jan",
            time: "2026-01-15T10:00:00Z",
          }),
        );
        await indexConversation(
          ctx,
          conversationFile({
            conversation_id: "conv-mar",
            time: "2026-03-15T10:00:00Z",
          }),
        );
        await indexTopic(
          ctx,
          topicFile({
            id: "auth",
            title: "Auth",
            items: [
              {
                type: "idea_unit_ref",
                conversation_id: "conv-jan",
                turn_index: 0,
                idea_unit_index: 0,
              },
              {
                type: "idea_unit_ref",
                conversation_id: "conv-mar",
                turn_index: 0,
                idea_unit_index: 0,
              },
            ],
          }),
        );
      },
    );
    await when("listing topic items since 2026-02-01", async () => {
      entries = await ctx.topics.listTopicItemsSince("auth", "2026-02-01T00:00:00Z");
    });
    await then("only the March idea unit is returned", () => {
      expect(entries).toHaveLength(1);
      expect(entries?.[0].type).toBe("idea_unit");
      if (entries?.[0].type === "idea_unit") {
        expect(entries[0].conversation_id).toBe("conv-mar");
      }
    });
  });

  test("Topic items skip idea units classified solely as Irrelevant", async () => {
    let entries: Awaited<ReturnType<typeof ctx.topics.listTopicItemsSince>> | null = null;

    await given(
      "a topic citing one Information idea unit and one Irrelevant idea unit",
      async () => {
        await indexConversation(
          ctx,
          conversationFile({
            conversation_id: "conv-1",
            turns: [
              {
                index: 0,
                speaker: "Alice",
                time: "2026-01-01T10:00:00Z",
                idea_units: [
                  { index: 0, sentences: ["Useful."], categories: ["Information"] },
                  { index: 1, sentences: ["Noise."], categories: ["Irrelevant"] },
                ],
              },
            ],
          }),
        );
        await indexTopic(
          ctx,
          topicFile({
            id: "auth",
            title: "Auth",
            items: [
              {
                type: "idea_unit_ref",
                conversation_id: "conv-1",
                turn_index: 0,
                idea_unit_index: 0,
              },
              {
                type: "idea_unit_ref",
                conversation_id: "conv-1",
                turn_index: 0,
                idea_unit_index: 1,
              },
            ],
          }),
        );
      },
    );
    await when("listing topic items with no date filter", async () => {
      entries = await ctx.topics.listTopicItemsSince("auth", null);
    });
    await then("only the Information idea unit appears", () => {
      expect(entries).toHaveLength(1);
      if (entries?.[0].type === "idea_unit") {
        expect(entries[0].idea_unit_index).toBe(0);
      }
    });
  });

  test("Listing topic summaries for given sources returns only topics that reference at least one of them", async () => {
    let summaries: Awaited<
      ReturnType<typeof ctx.topics.listTopicSummariesForSources>
    > | null = null;

    await given("topics 'Match' citing conv-1 and 'Skip' citing only conv-2", async () => {
      await indexConversation(ctx, conversationFile({ conversation_id: "conv-1" }));
      await indexConversation(ctx, conversationFile({ conversation_id: "conv-2" }));
      await indexTopic(
        ctx,
        topicFile({
          id: "match",
          title: "Match",
          items: [
            {
              type: "idea_unit_ref",
              conversation_id: "conv-1",
              turn_index: 0,
              idea_unit_index: 0,
            },
          ],
        }),
      );
      await indexTopic(
        ctx,
        topicFile({
          id: "skip",
          title: "Skip",
          items: [
            {
              type: "idea_unit_ref",
              conversation_id: "conv-2",
              turn_index: 0,
              idea_unit_index: 0,
            },
          ],
        }),
      );
    });
    await when("listing summaries for conv-1 only", async () => {
      summaries = await ctx.topics.listTopicSummariesForSources(["conv-1"], []);
    });
    await then("only the topic referencing conv-1 is returned, with its title path", () => {
      expect(summaries).toHaveLength(1);
      expect(summaries?.[0].id).toBe("match");
      expect(summaries?.[0].path).toEqual(["Match"]);
    });
  });
});

function topicFile(overrides: Partial<TopicFileNew> = {}): TopicFileNew {
  return TopicFileNewSchema.parse({
    id: "topic-1",
    parent_id: null,
    title: "Topic",
    short_summary: "Short",
    long_summary: "Long",
    items: [],
    reviewed: true,
    decisions_extracted: false,
    is_stale: false,
    ...overrides,
  });
}

function conversationFile(
  overrides: Partial<Conversation> = {},
): Conversation {
  return ConversationSchema.parse({
    conversation_id: "conv-1",
    time: "2026-01-01T10:00:00Z",
    main_topic: "Project kickoff",
    turns: [
      {
        index: 0,
        speaker: "Alice",
        time: "2026-01-01T10:00:00Z",
        idea_units: [
          { index: 0, sentences: ["Hello."], categories: ["Information"] },
        ],
      },
    ],
    ...overrides,
  });
}

function documentFile(overrides: Partial<DocumentFileNew> = {}): DocumentFileNew {
  return DocumentFileNewSchema.parse({
    document_id: "doc-1",
    title: "Vision",
    date: "2026-01-02",
    content: "Hello world!",
    fragments: [
      { kind: "paragraph", index: 0, start_offset: 0, end_offset: 5, section_path: [], text: "Hello" },
    ],
    section_tree: [],
    ...overrides,
  });
}

async function indexTopic(
  ctx: KnowledgeNewTestContext,
  file: TopicFileNew,
): Promise<void> {
  mkdirSync(join(ctx.projectDir, "noesis", "topics"), { recursive: true });
  const path = topicJsonPath(ctx.projectDir, file.id, file.title);
  writeFileSync(path, JSON.stringify(file, null, 2));
  await ctx.topics.indexFile(path);
}

async function indexConversation(
  ctx: KnowledgeNewTestContext,
  file: Conversation,
): Promise<void> {
  mkdirSync(join(ctx.projectDir, "noesis", "conversations"), { recursive: true });
  const path = conversationJsonPath(
    ctx.projectDir,
    file.conversation_id,
    file.main_topic,
  );
  writeFileSync(path, JSON.stringify(file, null, 2));
  await ctx.conversations.indexFile(path);
}

async function indexDocument(
  ctx: KnowledgeNewTestContext,
  file: DocumentFileNew,
): Promise<void> {
  mkdirSync(join(ctx.projectDir, "noesis", "documents"), { recursive: true });
  const path = documentJsonPath(ctx.projectDir, file.document_id, file.title);
  writeFileSync(path, JSON.stringify(file, null, 2));
  await ctx.documents.indexFile(path);
}
