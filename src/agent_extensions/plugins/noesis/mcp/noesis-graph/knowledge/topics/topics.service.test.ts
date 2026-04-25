import "reflect-metadata";
import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import { rmSync } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import {
  asArray,
  clearGraph,
  countNodes,
  countRels,
  createKnowledgeTestModule,
  sampleConversation,
  type KnowledgeTestContext,
} from "../test-helpers.js";
import { ConversationsService } from "../conversations/conversations.service.js";
import { documentFragmentNodeId } from "../documents/node-ids.js";
import { DocumentsService } from "../documents/documents.service.js";
import { TopicsService } from "./topics.service.js";

describe("TopicsService", () => {
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

  describe("addTopic", () => {
    test("creates a top-level topic with provided id", async () => {
      const { id } = await topics.addTopic({
        id: "topic-1",
        title: "Auth",
        short_summary: "Authentication scope",
      });
      expect(id).toBe("topic-1");
      expect(await countNodes(ctx.db, "Topic")).toBe(1);
    });

    test("generates a uuid when id omitted", async () => {
      const { id } = await topics.addTopic({
        title: "Auth",
        short_summary: "Authentication scope",
      });
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    });

    test("fails on duplicate id", async () => {
      await topics.addTopic({ id: "dup", title: "A", short_summary: "" });
      await expect(
        topics.addTopic({ id: "dup", title: "B", short_summary: "" }),
      ).rejects.toThrow(/already exists/);
    });
  });

  describe("addSubtopic", () => {
    test("creates a child topic under an existing parent", async () => {
      await topics.addTopic({ id: "p", title: "Parent", short_summary: "" });
      const { id } = await topics.addSubtopic("p", {
        id: "c",
        title: "Child",
        short_summary: "",
      });
      expect(id).toBe("c");
      expect(await countRels(ctx.db, "TOPIC_HAS_SUBTOPIC")).toBe(1);
    });

    test("fails when the parent is missing", async () => {
      await expect(
        topics.addSubtopic("missing", {
          id: "c",
          title: "Child",
          short_summary: "",
        }),
      ).rejects.toThrow(/Topic not found/);
    });
  });

  describe("reparentTopic", () => {
    test("moves a topic from one parent to another", async () => {
      await topics.addTopic({ id: "a", title: "A", short_summary: "" });
      await topics.addTopic({ id: "b", title: "B", short_summary: "" });
      await topics.addSubtopic("a", { id: "c", title: "C", short_summary: "" });

      await topics.reparentTopic("c", "b");

      const conn = ctx.db.getConnection();
      const result = await conn.query(
        "MATCH (p:Topic)-[:TOPIC_HAS_SUBTOPIC]->(c:Topic {id: 'c'}) RETURN p.id AS pid",
      );
      const rows = asArray(result).getAllSync() as Array<{ pid: string }>;
      expect(rows.map((r) => r.pid)).toEqual(["b"]);
    });

    test("makes a topic top-level when new parent is null", async () => {
      await topics.addTopic({ id: "a", title: "A", short_summary: "" });
      await topics.addSubtopic("a", { id: "c", title: "C", short_summary: "" });
      await topics.reparentTopic("c", null);
      expect(await countRels(ctx.db, "TOPIC_HAS_SUBTOPIC")).toBe(0);
    });

    test("fails on self-parenting", async () => {
      await topics.addTopic({ id: "a", title: "A", short_summary: "" });
      await expect(topics.reparentTopic("a", "a")).rejects.toThrow(
        /its own parent/,
      );
    });

    test("fails when new parent missing", async () => {
      await topics.addTopic({ id: "c", title: "C", short_summary: "" });
      await expect(topics.reparentTopic("c", "ghost")).rejects.toThrow(
        /Topic not found/,
      );
    });
  });

  describe("addItemsToTopic", () => {
    test("links existing idea units to a topic", async () => {
      const path = join(ctx.tmpDir, "conv.json");
      await writeFile(path, JSON.stringify(sampleConversation("conv-1")));
      await conversations.addConversationFromFile(path);
      await topics.addTopic({ id: "t1", title: "T1", short_summary: "" });

      const result = await topics.addItemsToTopic("t1", [
        {
          type: "idea_unit_ref",
          conversation_id: "conv-1",
          turn_index: 0,
          idea_unit_index: 0,
        },
      ]);
      expect(result).toEqual({ added: 1 });
      expect(await countRels(ctx.db, "TOPIC_HAS_IDEA_UNIT")).toBe(1);
    });

    test("creates document fragment on demand and links it", async () => {
      const docPath = join(ctx.tmpDir, "doc.json");
      await writeFile(
        docPath,
        JSON.stringify({
          id: "doc-1",
          title: "D",
          date: "2026-04-17",
          content: "some text",
        }),
      );
      await documents.addDocumentFromFile(docPath);
      await topics.addTopic({ id: "t1", title: "T1", short_summary: "" });

      await topics.addItemsToTopic("t1", [
        {
          type: "document_fragment_ref",
          document_id: "doc-1",
          start_offset: 0,
          end_offset: 4,
        },
      ]);

      expect(await countNodes(ctx.db, "DocumentFragment")).toBe(1);
      expect(await countRels(ctx.db, "TOPIC_HAS_DOCUMENT_FRAGMENT")).toBe(1);
      expect(await countRels(ctx.db, "DOCUMENT_HAS_FRAGMENT")).toBe(1);

      const fragId = documentFragmentNodeId("doc-1", 0, 4);
      const frag = await ctx.db
        .getConnection()
        .query(`MATCH (f:DocumentFragment {id: '${fragId}'}) RETURN f.id AS id`);
      expect(asArray(frag).getAllSync()).toEqual([{ id: fragId }]);
    });

    test("fails when idea unit does not exist", async () => {
      await topics.addTopic({ id: "t1", title: "T1", short_summary: "" });
      await expect(
        topics.addItemsToTopic("t1", [
          {
            type: "idea_unit_ref",
            conversation_id: "ghost",
            turn_index: 0,
            idea_unit_index: 0,
          },
        ]),
      ).rejects.toThrow(/Idea unit not found/);
    });

    test("fails when document does not exist", async () => {
      await topics.addTopic({ id: "t1", title: "T1", short_summary: "" });
      await expect(
        topics.addItemsToTopic("t1", [
          {
            type: "document_fragment_ref",
            document_id: "ghost",
            start_offset: 0,
            end_offset: 1,
          },
        ]),
      ).rejects.toThrow(/Document not found/);
    });
  });

  describe("listTopics", () => {
    test("lists root topics with path and has_subtopics flag", async () => {
      await topics.addTopic({ id: "r1", title: "Alpha", short_summary: "a" });
      await topics.addTopic({ id: "r2", title: "Beta", short_summary: "b" });
      await topics.addSubtopic("r1", {
        id: "r1c",
        title: "Alpha-child",
        short_summary: "c",
      });

      const rows = await topics.listTopics(null);
      expect(rows.map((t) => t.id).sort()).toEqual(["r1", "r2"]);
      const alpha = rows.find((t) => t.id === "r1")!;
      expect(alpha.has_subtopics).toBe(true);
      expect(alpha.path).toEqual(["Alpha"]);
      const beta = rows.find((t) => t.id === "r2")!;
      expect(beta.has_subtopics).toBe(false);
    });

    test("lists direct subtopics when parent is provided", async () => {
      await topics.addTopic({ id: "r1", title: "Root", short_summary: "" });
      await topics.addSubtopic("r1", {
        id: "c1",
        title: "Child",
        short_summary: "",
      });

      const rows = await topics.listTopics("r1");
      expect(rows.map((t) => t.id)).toEqual(["c1"]);
      expect(rows[0].path).toEqual(["Root", "Child"]);
    });
  });

  describe("readTopic", () => {
    test("returns topic detail with hierarchical path", async () => {
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

      const detail = await topics.readTopic("c");
      expect(detail).not.toBeNull();
      expect(detail!.id).toBe("c");
      expect(detail!.path).toEqual(["Root", "Child"]);
      expect(detail!.short_summary).toBe("cs");
      expect(detail!.long_summary).toBe("cl");
    });

    test("returns null for unknown topic", async () => {
      const detail = await topics.readTopic("missing");
      expect(detail).toBeNull();
    });
  });

  describe("listTopicSummariesForSources", () => {
    test("returns topics linked to the given conversation ids", async () => {
      const path = join(ctx.tmpDir, "conv.json");
      await writeFile(path, JSON.stringify(sampleConversation("conv-1")));
      await conversations.addConversationFromFile(path);

      await topics.addTopic({
        id: "t1",
        title: "T1",
        short_summary: "s",
        long_summary: "long-1",
      });
      await topics.addTopic({
        id: "t2",
        title: "T2",
        short_summary: "s",
        long_summary: "long-2",
      });
      await topics.addItemsToTopic("t1", [
        {
          type: "idea_unit_ref",
          conversation_id: "conv-1",
          turn_index: 0,
          idea_unit_index: 0,
        },
      ]);

      const rows = await topics.listTopicSummariesForSources(["conv-1"], []);
      expect(rows.map((r) => r.id)).toEqual(["t1"]);
      expect(rows[0].long_summary).toBe("long-1");
    });

    test("merges results across conversations and documents", async () => {
      const convPath = join(ctx.tmpDir, "conv2.json");
      await writeFile(convPath, JSON.stringify(sampleConversation("conv-2")));
      await conversations.addConversationFromFile(convPath);

      const docPath = join(ctx.tmpDir, "doc2.json");
      await writeFile(
        docPath,
        JSON.stringify({
          id: "doc-2",
          title: "D",
          date: "2026-04-17",
          content: "lorem ipsum text",
        }),
      );
      await documents.addDocumentFromFile(docPath);

      await topics.addTopic({ id: "ta", title: "Alpha", short_summary: "" });
      await topics.addTopic({ id: "tb", title: "Beta", short_summary: "" });

      await topics.addItemsToTopic("ta", [
        {
          type: "idea_unit_ref",
          conversation_id: "conv-2",
          turn_index: 0,
          idea_unit_index: 0,
        },
      ]);
      await topics.addItemsToTopic("tb", [
        {
          type: "document_fragment_ref",
          document_id: "doc-2",
          start_offset: 0,
          end_offset: 5,
        },
      ]);

      const rows = await topics.listTopicSummariesForSources(
        ["conv-2"],
        ["doc-2"],
      );
      expect(rows.map((r) => r.title)).toEqual(["Alpha", "Beta"]);
    });

    test("returns empty list when no sources provided", async () => {
      const rows = await topics.listTopicSummariesForSources([], []);
      expect(rows).toEqual([]);
    });
  });

  describe("listTopicItemsSince", () => {
    test("returns idea units and document fragments attached to a topic", async () => {
      const convPath = join(ctx.tmpDir, "conv3.json");
      await writeFile(convPath, JSON.stringify(sampleConversation("conv-3")));
      await conversations.addConversationFromFile(convPath);

      const docPath = join(ctx.tmpDir, "doc3.json");
      await writeFile(
        docPath,
        JSON.stringify({
          id: "doc-3",
          title: "D",
          date: "2026-04-20",
          content: "abcdef ghijk",
        }),
      );
      await documents.addDocumentFromFile(docPath);

      await topics.addTopic({ id: "tx", title: "Tx", short_summary: "" });
      await topics.addItemsToTopic("tx", [
        {
          type: "idea_unit_ref",
          conversation_id: "conv-3",
          turn_index: 0,
          idea_unit_index: 0,
        },
        {
          type: "document_fragment_ref",
          document_id: "doc-3",
          start_offset: 0,
          end_offset: 6,
        },
      ]);

      const items = await topics.listTopicItemsSince("tx", null);
      expect(items).toHaveLength(2);
      const types = items.map((i) => i.type).sort();
      expect(types).toEqual(["document_fragment", "idea_unit"]);
    });

    test("filters by `since` against source date", async () => {
      const oldConv = join(ctx.tmpDir, "conv-old.json");
      const newConv = join(ctx.tmpDir, "conv-new.json");
      await writeFile(
        oldConv,
        JSON.stringify({
          ...(sampleConversation("conv-old") as object),
          time: "2026-01-01T00:00:00Z",
        }),
      );
      await writeFile(
        newConv,
        JSON.stringify({
          ...(sampleConversation("conv-new") as object),
          time: "2026-04-01T00:00:00Z",
        }),
      );
      await conversations.addConversationFromFile(oldConv);
      await conversations.addConversationFromFile(newConv);

      await topics.addTopic({ id: "tf", title: "Tf", short_summary: "" });
      await topics.addItemsToTopic("tf", [
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

      const items = await topics.listTopicItemsSince(
        "tf",
        "2026-03-01T00:00:00Z",
      );
      expect(items).toHaveLength(1);
      expect(items[0].type === "idea_unit" && items[0].conversation_id).toBe(
        "conv-new",
      );
    });

    test("fails when topic does not exist", async () => {
      await expect(topics.listTopicItemsSince("ghost", null)).rejects.toThrow(
        /Topic not found/,
      );
    });
  });
});
