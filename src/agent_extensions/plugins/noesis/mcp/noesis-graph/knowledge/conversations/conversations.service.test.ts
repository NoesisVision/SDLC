import "reflect-metadata";
import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  asArray,
  clearGraph,
  countNodes,
  countRels,
  createKnowledgeTestModule,
  sampleConversation,
  type KnowledgeTestContext,
} from "../test-helpers.js";
import { ideaUnitNodeId, turnNodeId } from "./node-ids.js";
import { ConversationsService } from "./conversations.service.js";

describe("ConversationsService", () => {
  let ctx: KnowledgeTestContext;
  let conversations: ConversationsService;

  beforeAll(async () => {
    ctx = await createKnowledgeTestModule();
    conversations = ctx.module.get(ConversationsService);
  });

  afterAll(async () => {
    await ctx.module.close();
    rmSync(ctx.tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await clearGraph(ctx.db);
  });

  describe("addConversationFromFile", () => {
    test("creates Conversation, Turn, and IdeaUnit nodes", async () => {
      const path = join(ctx.tmpDir, "conv.json");
      await writeFile(path, JSON.stringify(sampleConversation("conv-1")));

      const result = await conversations.addConversationFromFile(path);
      expect(result).toEqual({
        conversation_id: "conv-1",
        turns: 2,
        idea_units: 3,
      });
      expect(await countNodes(ctx.db, "Conversation")).toBe(1);
      expect(await countNodes(ctx.db, "Turn")).toBe(2);
      expect(await countNodes(ctx.db, "IdeaUnit")).toBe(3);
      expect(await countRels(ctx.db, "CONVERSATION_HAS_TURN")).toBe(2);
      expect(await countRels(ctx.db, "TURN_HAS_IDEA_UNIT")).toBe(3);
    });

    test("uses synthetic ids for turns and idea units", async () => {
      const path = join(ctx.tmpDir, "conv.json");
      await writeFile(path, JSON.stringify(sampleConversation("conv-1")));
      await conversations.addConversationFromFile(path);

      const expectedTurnId = turnNodeId("conv-1", 0);
      const expectedIuId = ideaUnitNodeId("conv-1", 0, 0);

      const turn = await ctx.db
        .getConnection()
        .query(`MATCH (t:Turn {id: '${expectedTurnId}'}) RETURN t.id AS id`);
      expect(asArray(turn).getAllSync()).toEqual([{ id: expectedTurnId }]);

      const iu = await ctx.db
        .getConnection()
        .query(`MATCH (u:IdeaUnit {id: '${expectedIuId}'}) RETURN u.id AS id`);
      expect(asArray(iu).getAllSync()).toEqual([{ id: expectedIuId }]);
    });

    test("fails when conversation id already exists", async () => {
      const path = join(ctx.tmpDir, "conv.json");
      await writeFile(path, JSON.stringify(sampleConversation("conv-dup")));
      await conversations.addConversationFromFile(path);
      await expect(conversations.addConversationFromFile(path)).rejects.toThrow(
        /already exists/,
      );
    });
  });

  describe("hasConversation", () => {
    test("returns true for existing conversation and false otherwise", async () => {
      const path = join(ctx.tmpDir, "conv.json");
      await writeFile(path, JSON.stringify(sampleConversation("conv-1")));
      expect(await conversations.hasConversation("conv-1")).toBe(false);
      await conversations.addConversationFromFile(path);
      expect(await conversations.hasConversation("conv-1")).toBe(true);
    });
  });

  describe("mergeConversation", () => {
    test("inserts conversation, upserts topics, and adds nested decisions", async () => {
      const workingDir = mkdtempSync(join(tmpdir(), "noesis-merge-"));
      try {
        const conv = {
          conversation_id: "m1",
          time: "2026-04-17T10:00:00Z",
          main_topic: "Merge",
          turns: [
            {
              index: 0,
              speaker: "alice",
              time: "2026-04-17T10:00:00Z",
              idea_units: [
                { index: 0, sentences: ["hello"], categories: ["Information"] },
              ],
            },
          ],
          topics: [
            {
              id: "m-topic-1",
              title: "Merged Topic",
              short_summary: "s",
              long_summary: "l",
              items: [
                {
                  type: "idea_unit_ref",
                  conversation_id: "m1",
                  turn_index: 0,
                  idea_unit_index: 0,
                },
              ],
              decisions: [
                {
                  id: "m-dec-1",
                  title: "Pick A",
                  status: "accepted",
                  referenced_items: [],
                  context: { text: "", supporting_item_indices: [] },
                  decision: { text: "", rationale: "", supporting_item_indices: [] },
                  alternative_options: [],
                },
              ],
              reviewed: true,
              decisions_extracted: true,
            },
          ],
        };

        const output = {
          conversation: conv,
          potential_topics: {
            topics: [
              {
                id: "m-topic-1",
                title: "Merged Topic",
                short_summary: "s",
                path: ["Merged Topic"],
                is_new: true,
                parent_id: null,
              },
            ],
          },
        };
        await writeFile(
          join(workingDir, "output.json"),
          JSON.stringify(output),
        );

        const result = await conversations.mergeConversation(workingDir);
        expect(result).toEqual({
          conversation_id: "m1",
          topics_added: 1,
          topics_updated: 0,
          decisions_added: 1,
        });

        expect(await countNodes(ctx.db, "Conversation")).toBe(1);
        expect(await countNodes(ctx.db, "Topic")).toBe(1);
        expect(await countNodes(ctx.db, "Decision")).toBe(1);
        expect(await countRels(ctx.db, "TOPIC_HAS_IDEA_UNIT")).toBe(1);
        expect(await countRels(ctx.db, "TOPIC_HAS_DECISION")).toBe(1);
      } finally {
        rmSync(workingDir, { recursive: true, force: true });
      }
    });
  });

  describe("prepareReviewBundle", () => {
    test("emits all topics in post-order (leaves before parents)", async () => {
      const workingDir = mkdtempSync(join(tmpdir(), "noesis-review-"));
      try {
        const conv = {
          conversation_id: "post-1",
          time: "2026-04-17T10:00:00Z",
          main_topic: "PostOrder",
          turns: [
            {
              index: 0,
              speaker: "alice",
              time: "2026-04-17T10:00:00Z",
              idea_units: [
                { index: 0, sentences: ["hello"], categories: ["Information"] },
              ],
            },
          ],
          topics: [
            {
              id: "root",
              title: "Root",
              short_summary: "",
              long_summary: "",
              items: [],
              decisions: [],
              reviewed: false,
              decisions_extracted: false,
            },
            {
              id: "leaf",
              title: "Leaf",
              short_summary: "",
              long_summary: "",
              items: [
                {
                  type: "idea_unit_ref",
                  conversation_id: "post-1",
                  turn_index: 0,
                  idea_unit_index: 0,
                },
              ],
              decisions: [],
              reviewed: false,
              decisions_extracted: false,
            },
          ],
        };
        const output = {
          conversation: conv,
          potential_topics: {
            topics: [
              {
                id: "root",
                title: "Root",
                short_summary: "",
                path: ["Root"],
                is_new: true,
                parent_id: null,
              },
              {
                id: "leaf",
                title: "Leaf",
                short_summary: "",
                path: ["Root", "Leaf"],
                is_new: true,
                parent_id: "root",
              },
            ],
          },
        };
        await writeFile(
          join(workingDir, "output.json"),
          JSON.stringify(output),
        );

        const bundle = await conversations.prepareReviewBundle(
          join(workingDir, "output.json"),
        );
        expect(bundle.topic_count).toBe(2);
        expect(bundle.topics_with_prior_units).toBe(0);
        const leafIdx = bundle.markdown.indexOf("topic_id: leaf");
        const rootIdx = bundle.markdown.indexOf("topic_id: root");
        expect(leafIdx).toBeGreaterThanOrEqual(0);
        expect(rootIdx).toBeGreaterThanOrEqual(0);
        expect(leafIdx).toBeLessThan(rootIdx);
        expect(bundle.markdown).toContain("# Topics for review");
        expect(bundle.markdown).toContain("\n---\n");
      } finally {
        rmSync(workingDir, { recursive: true, force: true });
      }
    });

    test("renders ## Subtopics block with reviewed children's summaries and pending markers", async () => {
      const workingDir = mkdtempSync(join(tmpdir(), "noesis-review-"));
      try {
        const conv = {
          conversation_id: "sub-1",
          time: "2026-04-17T10:00:00Z",
          main_topic: "Sub",
          turns: [],
          topics: [
            {
              id: "parent",
              title: "Parent",
              short_summary: "",
              long_summary: "",
              items: [],
              decisions: [],
              reviewed: false,
              decisions_extracted: false,
            },
            {
              id: "child-a",
              title: "Child A",
              short_summary: "summary A",
              long_summary: "long A",
              items: [],
              decisions: [],
              reviewed: true,
              decisions_extracted: true,
            },
            {
              id: "child-b",
              title: "Child B",
              short_summary: "",
              long_summary: "",
              items: [],
              decisions: [],
              reviewed: true,
              decisions_extracted: true,
            },
          ],
        };
        const output = {
          conversation: conv,
          potential_topics: {
            topics: [
              {
                id: "parent",
                title: "Parent",
                short_summary: "",
                path: ["Parent"],
                is_new: true,
                parent_id: null,
              },
              {
                id: "child-a",
                title: "Child A",
                short_summary: "summary A",
                path: ["Parent", "Child A"],
                is_new: true,
                parent_id: "parent",
              },
              {
                id: "child-b",
                title: "Child B",
                short_summary: "",
                path: ["Parent", "Child B"],
                is_new: true,
                parent_id: "parent",
              },
            ],
          },
        };
        await writeFile(
          join(workingDir, "output.json"),
          JSON.stringify(output),
        );

        const bundle = await conversations.prepareReviewBundle(
          join(workingDir, "output.json"),
        );
        expect(bundle.markdown).toContain("## Subtopics");
        expect(bundle.markdown).toContain("**Child A** — summary A");
        expect(bundle.markdown).toContain("**Child B** — _(pending review)_");
      } finally {
        rmSync(workingDir, { recursive: true, force: true });
      }
    });

    test("returns an empty bundle when there are no topics", async () => {
      const workingDir = mkdtempSync(join(tmpdir(), "noesis-review-"));
      try {
        const conv = {
          conversation_id: "empty-1",
          time: "2026-04-17T10:00:00Z",
          main_topic: "Empty",
          turns: [],
          topics: [],
        };
        await writeFile(
          join(workingDir, "output.json"),
          JSON.stringify({ conversation: conv, potential_topics: { topics: [] } }),
        );
        const bundle = await conversations.prepareReviewBundle(
          join(workingDir, "output.json"),
        );
        expect(bundle.topic_count).toBe(0);
        expect(bundle.topics_with_prior_units).toBe(0);
        expect(bundle.markdown).toContain("# Topics for review");
      } finally {
        rmSync(workingDir, { recursive: true, force: true });
      }
    });
  });

  describe("validateOutput", () => {
    test("returns Ok for a valid output", async () => {
      const workingDir = mkdtempSync(join(tmpdir(), "noesis-validate-"));
      try {
        const conv = {
          conversation_id: "v1",
          time: "2026-04-17T10:00:00Z",
          main_topic: "V",
          turns: [
            {
              index: 0,
              speaker: "alice",
              time: "2026-04-17T10:00:00Z",
              idea_units: [
                { index: 0, sentences: ["x"], categories: ["Information"] },
              ],
            },
          ],
          topics: [
            {
              id: "vt1",
              title: "T",
              short_summary: "",
              long_summary: "",
              items: [
                {
                  type: "idea_unit_ref",
                  conversation_id: "v1",
                  turn_index: 0,
                  idea_unit_index: 0,
                },
              ],
              decisions: [],
              reviewed: false,
              decisions_extracted: false,
            },
          ],
        };
        const output = {
          conversation: conv,
          potential_topics: {
            topics: [
              {
                id: "vt1",
                title: "T",
                short_summary: "",
                path: ["T"],
                is_new: true,
                parent_id: null,
              },
            ],
          },
        };
        await writeFile(
          join(workingDir, "output.json"),
          JSON.stringify(output),
        );
        const result = await conversations.validateOutput(workingDir);
        expect(result.status).toBe("Ok");
      } finally {
        rmSync(workingDir, { recursive: true, force: true });
      }
    });

    test("returns Errors with paths for unassigned non-Irrelevant idea units", async () => {
      const workingDir = mkdtempSync(join(tmpdir(), "noesis-validate-"));
      try {
        const conv = {
          conversation_id: "v2",
          time: "2026-04-17T10:00:00Z",
          main_topic: "V",
          turns: [
            {
              index: 0,
              speaker: "alice",
              time: "2026-04-17T10:00:00Z",
              idea_units: [
                { index: 0, sentences: ["x"], categories: ["Information"] },
              ],
            },
          ],
          topics: [],
        };
        await writeFile(
          join(workingDir, "output.json"),
          JSON.stringify({ conversation: conv, potential_topics: { topics: [] } }),
        );
        const result = await conversations.validateOutput(workingDir);
        expect(result.status).toBe("Errors");
        if (result.status !== "Errors") return;
        expect(
          result.errors.some((e) =>
            e.message.includes("not assigned to any topic"),
          ),
        ).toBe(true);
      } finally {
        rmSync(workingDir, { recursive: true, force: true });
      }
    });
  });

  describe("mergeConversation pre-flight gate", () => {
    test("rejects an invalid output before persisting anything", async () => {
      const workingDir = mkdtempSync(join(tmpdir(), "noesis-merge-bad-"));
      try {
        const conv = {
          conversation_id: "bad-1",
          time: "2026-04-17T10:00:00Z",
          main_topic: "Bad",
          turns: [
            {
              index: 0,
              speaker: "alice",
              time: "2026-04-17T10:00:00Z",
              idea_units: [
                { index: 0, sentences: ["x"], categories: ["Information"] },
              ],
            },
          ],
          topics: [],
        };
        await writeFile(
          join(workingDir, "output.json"),
          JSON.stringify({ conversation: conv, potential_topics: { topics: [] } }),
        );
        await expect(conversations.mergeConversation(workingDir)).rejects.toThrow(
          /Output validation failed/,
        );
        expect(await countNodes(ctx.db, "Conversation")).toBe(0);
      } finally {
        rmSync(workingDir, { recursive: true, force: true });
      }
    });
  });
});
