import "reflect-metadata";
import {
  describe,
  test,
  beforeAll,
  afterAll,
  beforeEach,
  expect,
} from "bun:test";
import { rmSync } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import { and, given, then, when } from "@tests/bdd.js";
import {
  clearGraph,
  countNodes,
  countRels,
  createKnowledgeTestModule,
  sampleConversation,
  type KnowledgeTestContext,
} from "@tests/helpers/knowledge-test-context.js";
import { ConversationsService } from "@noesis/mcp/noesis-graph/knowledge/conversations/conversations.service.js";
import { DocumentsService } from "@noesis/mcp/noesis-graph/knowledge/documents/documents.service.js";
import { TopicsService } from "@noesis/mcp/noesis-graph/knowledge/topics/topics.service.js";

describe("TopicsService — managing the topic hierarchy and its supporting items", () => {
  let ctx: KnowledgeTestContext;
  let topics: TopicsService;
  let conversations: ConversationsService;
  let documents: DocumentsService;

  beforeAll(async () => {
    ctx = await createKnowledgeTestModule();
    topics = ctx.module.get(TopicsService);
    conversations = ctx.module.get(ConversationsService);
    documents = ctx.module.get(DocumentsService);
  });

  afterAll(async () => {
    await ctx.module.close();
    rmSync(ctx.tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await clearGraph(ctx.db);
  });

  test("generateTopicIds returns the requested number of unique UUIDs", async () => {
    let ids: string[];

    await given("a fresh TopicsService not bound to any DB state", () => {});
    await when("the agent asks for five topic ids", () => {
      ids = topics.generateTopicIds(5).ids;
    });
    await then("five distinct UUIDs are returned", () => {
      expect(ids).toHaveLength(5);
      expect(new Set(ids).size).toBe(5);
      for (const id of ids) {
        expect(id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      }
    });
  });

  test("generateTopicIds rejects counts outside the [1, 50] safety window", async () => {
    await given("a fresh TopicsService", () => {});
    await when("a caller asks for an out-of-range count", () => {});
    await then("the request fails for zero, oversize, and fractional counts", () => {
      expect(() => topics.generateTopicIds(0)).toThrow();
      expect(() => topics.generateTopicIds(51)).toThrow();
      expect(() => topics.generateTopicIds(1.5)).toThrow();
    });
  });

  test("adding a top-level topic stores it under the supplied id", async () => {
    let id: string;

    await given("an empty topic graph", () => {});
    await when("a caller adds a top-level topic with an explicit id", async () => {
      id = (
        await topics.addTopic({
          id: "topic-1",
          title: "Auth",
          short_summary: "Authentication scope",
        })
      ).id;
    });
    await then("the returned id matches the request", () => {
      expect(id).toBe("topic-1");
    });
    await and("a single Topic node is present in the graph", async () => {
      expect(await countNodes(ctx.db, "Topic")).toBe(1);
    });
  });

  test("attempting to add a topic with a duplicate id is rejected", async () => {
    let thrown: Error | null = null;

    await given("a topic that has already been recorded", async () => {
      await topics.addTopic({
        id: "dup",
        title: "A",
        short_summary: "",
      });
    });
    await when("a second topic with the same id is added", async () => {
      try {
        await topics.addTopic({ id: "dup", title: "B", short_summary: "" });
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the operation fails with an explicit duplication error", () => {
      expect(thrown?.message).toMatch(/already exists/);
    });
  });

  test("adding a subtopic creates a parent/child link", async () => {
    let childId: string;

    await given("an existing parent topic", async () => {
      await topics.addTopic({
        id: "p",
        title: "Parent",
        short_summary: "",
      });
    });
    await when("a child topic is added under the parent", async () => {
      childId = (
        await topics.addSubtopic("p", {
          id: "c",
          title: "Child",
          short_summary: "",
        })
      ).id;
    });
    await then("the child id is returned and a parent/child edge is recorded", async () => {
      expect(childId).toBe("c");
      expect(await countRels(ctx.db, "TOPIC_HAS_SUBTOPIC")).toBe(1);
    });
  });

  test("reparenting moves a topic from one parent to another", async () => {
    let pathBefore: string[];
    let pathAfter: string[];

    await given("a tree with topic c under topic a (and b empty)", async () => {
      await topics.addTopic({ id: "a", title: "A", short_summary: "" });
      await topics.addTopic({ id: "b", title: "B", short_summary: "" });
      await topics.addSubtopic("a", { id: "c", title: "C", short_summary: "" });
      pathBefore = (await topics.readTopic("c"))!.path;
    });
    await when("topic c is reparented from a to b", async () => {
      await topics.reparentTopic("c", "b");
      pathAfter = (await topics.readTopic("c"))!.path;
    });
    await then("c's hierarchical path moves from [A, C] to [B, C]", () => {
      expect(pathBefore).toEqual(["A", "C"]);
      expect(pathAfter).toEqual(["B", "C"]);
    });
  });

  test("a topic cannot be reparented to itself", async () => {
    let thrown: Error | null = null;

    await given("a top-level topic a", async () => {
      await topics.addTopic({ id: "a", title: "A", short_summary: "" });
    });
    await when("a caller tries to make a its own parent", async () => {
      try {
        await topics.reparentTopic("a", "a");
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the operation fails with a self-parent error", () => {
      expect(thrown?.message).toMatch(/its own parent/);
    });
  });

  test("linking idea unit and document fragment items to a topic", async () => {
    let result: { added: number };

    await given(
      "a topic, a recorded conversation, and a recorded document",
      async () => {
        await topics.addTopic({ id: "t1", title: "T1", short_summary: "" });

        const convPath = join(ctx.tmpDir, "conv.json");
        await writeFile(
          convPath,
          JSON.stringify(sampleConversation("conv-1")),
        );
        await conversations.addConversationFromFile(convPath);

        const docPath = join(ctx.tmpDir, "doc.json");
        await writeFile(
          docPath,
          JSON.stringify({
            id: "doc-1",
            title: "D",
            date: "2026-04-17",
            content: "lorem ipsum",
          }),
        );
        await documents.addDocumentFromFile(docPath);
      },
    );
    await when(
      "the topic is linked to one idea unit and one document fragment",
      async () => {
        result = await topics.addItemsToTopic("t1", [
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
        ]);
      },
    );
    await then("the count of added items is two", () => {
      expect(result).toEqual({ added: 2 });
    });
    await and("each link kind is reflected once in the graph", async () => {
      expect(await countRels(ctx.db, "TOPIC_HAS_IDEA_UNIT")).toBe(1);
      expect(await countRels(ctx.db, "TOPIC_HAS_DOCUMENT_FRAGMENT")).toBe(1);
      expect(await countNodes(ctx.db, "DocumentFragment")).toBe(1);
    });
  });

  test("attempting to link an unknown idea unit fails fast", async () => {
    let thrown: Error | null = null;

    await given("a topic with no recorded conversations or documents", async () => {
      await topics.addTopic({ id: "t1", title: "T1", short_summary: "" });
    });
    await when(
      "the caller tries to attach an idea unit from a non-existent conversation",
      async () => {
        try {
          await topics.addItemsToTopic("t1", [
            {
              type: "idea_unit_ref",
              conversation_id: "ghost",
              turn_index: 0,
              idea_unit_index: 0,
            },
          ]);
        } catch (e) {
          thrown = e as Error;
        }
      },
    );
    await then("the error names the missing idea unit so the caller can fix the input", () => {
      expect(thrown?.message).toMatch(/Idea unit not found/);
    });
  });

  test("listing root topics returns only top-level entries with their subtopic flag", async () => {
    let rows: Awaited<ReturnType<TopicsService["listTopics"]>>;

    await given(
      "two top-level topics where one has a single subtopic",
      async () => {
        await topics.addTopic({ id: "r1", title: "Alpha", short_summary: "a" });
        await topics.addTopic({ id: "r2", title: "Beta", short_summary: "b" });
        await topics.addSubtopic("r1", {
          id: "r1c",
          title: "Alpha-child",
          short_summary: "c",
        });
      },
    );
    await when("the caller lists topics with no parent filter", async () => {
      rows = await topics.listTopics(null);
    });
    await then("only the two roots are returned", () => {
      expect(rows.map((t) => t.id).sort()).toEqual(["r1", "r2"]);
    });
    await and(
      "Alpha is flagged as having subtopics while Beta is not",
      () => {
        const alpha = rows.find((t) => t.id === "r1")!;
        const beta = rows.find((t) => t.id === "r2")!;
        expect(alpha.has_subtopics).toBe(true);
        expect(alpha.path).toEqual(["Alpha"]);
        expect(beta.has_subtopics).toBe(false);
      },
    );
  });

  test("readTopic returns the full path for a nested topic", async () => {
    let detail: Awaited<ReturnType<TopicsService["readTopic"]>>;

    await given("a parent/child pair of topics", async () => {
      await topics.addTopic({
        id: "r",
        title: "Root",
        short_summary: "short",
        long_summary: "long",
      });
      await topics.addSubtopic("r", {
        id: "c",
        title: "Child",
        short_summary: "cs",
        long_summary: "cl",
      });
    });
    await when("the caller reads the child topic's detail", async () => {
      detail = await topics.readTopic("c");
    });
    await then(
      "the detail carries the child's id, summaries, and hierarchical path",
      () => {
        expect(detail).not.toBeNull();
        expect(detail!.id).toBe("c");
        expect(detail!.path).toEqual(["Root", "Child"]);
        expect(detail!.short_summary).toBe("cs");
        expect(detail!.long_summary).toBe("cl");
      },
    );
  });

  test("readTopic returns null for an unknown topic", async () => {
    let detail: Awaited<ReturnType<TopicsService["readTopic"]>>;

    await given("an empty graph", () => {});
    await when("the caller reads an unknown topic id", async () => {
      detail = await topics.readTopic("missing");
    });
    await then("the result is null instead of throwing", () => {
      expect(detail).toBeNull();
    });
  });

  test("upserting a topic inserts when missing and updates when present", async () => {
    let firstResult: { added: boolean; updated: boolean };
    let secondResult: { added: boolean; updated: boolean };
    let storedTitle: string | undefined;

    await given("an empty topic graph", () => {});
    await when(
      "the same topic id is upserted twice with a new title on the second call",
      async () => {
        firstResult = await topics.upsertTopic({
          id: "u1",
          title: "Original",
          short_summary: "",
          long_summary: "",
        });
        secondResult = await topics.upsertTopic({
          id: "u1",
          title: "Renamed",
          short_summary: "",
          long_summary: "",
        });
        storedTitle = (await topics.readTopic("u1"))?.title;
      },
    );
    await then("the first call reports an insert", () => {
      expect(firstResult).toEqual({ added: true, updated: false });
    });
    await and("the second call reports an update", () => {
      expect(secondResult).toEqual({ added: false, updated: true });
    });
    await and("the stored title reflects the last write", () => {
      expect(storedTitle).toBe("Renamed");
    });
  });

  test("updateTopicEditableFields rejects an empty title", async () => {
    let thrown: Error | null = null;

    await given("a stored topic", async () => {
      await topics.addTopic({ id: "u", title: "Title", short_summary: "" });
    });
    await when("the caller tries to clear the topic title", async () => {
      try {
        await topics.updateTopicEditableFields("u", { title: "   " });
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the operation fails because titles must not be empty", () => {
      expect(thrown?.message).toMatch(/title must not be empty/);
    });
  });

  test("attempting to add items to an unknown topic fails before any link is created", async () => {
    let thrown: Error | null = null;

    await given("a graph with no topics", () => {});
    await when(
      "the caller tries to attach items to a topic id that does not exist",
      async () => {
        try {
          await topics.addItemsToTopic("ghost", []);
        } catch (e) {
          thrown = e as Error;
        }
      },
    );
    await then("the operation fails with a topic-not-found error", () => {
      expect(thrown?.message).toMatch(/Topic not found/);
    });
  });

  test("reparenting a topic to null promotes it to the top level", async () => {
    let pathBefore: string[];
    let pathAfter: string[];

    await given("a topic recorded as a child of another topic", async () => {
      await topics.addTopic({ id: "p", title: "Parent", short_summary: "" });
      await topics.addSubtopic("p", {
        id: "c",
        title: "Child",
        short_summary: "",
      });
      pathBefore = (await topics.readTopic("c"))!.path;
    });
    await when("the child is reparented with newParentTopicId=null", async () => {
      await topics.reparentTopic("c", null);
      pathAfter = (await topics.readTopic("c"))!.path;
    });
    await then(
      "the child's hierarchical path collapses from [Parent, Child] to [Child]",
      () => {
        expect(pathBefore).toEqual(["Parent", "Child"]);
        expect(pathAfter).toEqual(["Child"]);
      },
    );
  });

  test(
    "listTopicSummariesForSources merges topics linked to the requested conversations and documents",
    async () => {
      let summaries: Awaited<
        ReturnType<TopicsService["listTopicSummariesForSources"]>
      >;

      await given(
        "two topics: one linked to a conversation, the other to a document, plus an unrelated topic",
        async () => {
          const convPath = join(ctx.tmpDir, "conv-src.json");
          await writeFile(
            convPath,
            JSON.stringify(sampleConversation("conv-src")),
          );
          await conversations.addConversationFromFile(convPath);
          const docPath = join(ctx.tmpDir, "doc-src.json");
          await writeFile(
            docPath,
            JSON.stringify({
              id: "doc-src",
              title: "Doc",
              date: "2026-04-24",
              content: "lorem ipsum dolor",
            }),
          );
          await documents.addDocumentFromFile(docPath);

          await topics.addTopic({ id: "t-conv", title: "FromConv", short_summary: "" });
          await topics.addItemsToTopic("t-conv", [
            {
              type: "idea_unit_ref",
              conversation_id: "conv-src",
              turn_index: 0,
              idea_unit_index: 0,
            },
          ]);
          await topics.addTopic({ id: "t-doc", title: "FromDoc", short_summary: "" });
          await topics.addItemsToTopic("t-doc", [
            {
              type: "document_fragment_ref",
              document_id: "doc-src",
              start_offset: 0,
              end_offset: 5,
            },
          ]);
          await topics.addTopic({ id: "t-other", title: "Unrelated", short_summary: "" });
        },
      );
      await when(
        "the consumer asks for topics tied to the conversation and the document",
        async () => {
          summaries = await topics.listTopicSummariesForSources(
            ["conv-src"],
            ["doc-src"],
          );
        },
      );
      await then(
        "exactly the two source-linked topics are returned, the unrelated one is not",
        () => {
          expect(summaries.map((s) => s.id).sort()).toEqual(["t-conv", "t-doc"]);
        },
      );
      await and("each returned topic carries its hierarchical path", () => {
        for (const s of summaries) {
          expect(s.path.length).toBeGreaterThanOrEqual(1);
        }
      });
    },
  );

  test(
    "listTopicItemsSince filters supporting items by the originating source date",
    async () => {
      let allItems: Awaited<ReturnType<TopicsService["listTopicItemsSince"]>>;
      let recentItems: Awaited<ReturnType<TopicsService["listTopicItemsSince"]>>;

      await given(
        "a topic linked to two idea units from conversations dated April 1 and April 17",
        async () => {
          const oldConv = {
            conversation_id: "conv-old",
            time: "2026-04-01T10:00:00Z",
            main_topic: "Old",
            turns: [
              {
                index: 0,
                speaker: "alice",
                time: "2026-04-01T10:00:00Z",
                idea_units: [
                  { index: 0, sentences: ["older"], categories: ["Information"] },
                ],
              },
            ],
            topics: [],
            decisions: [],
          };
          const newConv = {
            conversation_id: "conv-new",
            time: "2026-04-17T10:00:00Z",
            main_topic: "New",
            turns: [
              {
                index: 0,
                speaker: "bob",
                time: "2026-04-17T10:00:00Z",
                idea_units: [
                  { index: 0, sentences: ["newer"], categories: ["Information"] },
                ],
              },
            ],
            topics: [],
            decisions: [],
          };
          const oldPath = join(ctx.tmpDir, "conv-old.json");
          const newPath = join(ctx.tmpDir, "conv-new.json");
          await writeFile(oldPath, JSON.stringify(oldConv));
          await writeFile(newPath, JSON.stringify(newConv));
          await conversations.addConversationFromFile(oldPath);
          await conversations.addConversationFromFile(newPath);

          await topics.addTopic({ id: "t-since", title: "Since", short_summary: "" });
          await topics.addItemsToTopic("t-since", [
            {
              type: "idea_unit_ref",
              conversation_id: "conv-old",
              turn_index: 0,
              idea_unit_index: 0,
            },
            {
              type: "idea_unit_ref",
              conversation_id: "conv-new",
              turn_index: 0,
              idea_unit_index: 0,
            },
          ]);
        },
      );
      await when(
        "the consumer requests items with no date filter, then with since=April 10",
        async () => {
          allItems = await topics.listTopicItemsSince("t-since", null);
          recentItems = await topics.listTopicItemsSince(
            "t-since",
            "2026-04-10T00:00:00Z",
          );
        },
      );
      await then(
        "the unfiltered query returns both items while the since filter keeps only the newer one",
        () => {
          expect(allItems).toHaveLength(2);
          expect(recentItems).toHaveLength(1);
          expect(recentItems[0].type).toBe("idea_unit");
          if (recentItems[0].type === "idea_unit") {
            expect(recentItems[0].conversation_id).toBe("conv-new");
          }
        },
      );
    },
  );
});
