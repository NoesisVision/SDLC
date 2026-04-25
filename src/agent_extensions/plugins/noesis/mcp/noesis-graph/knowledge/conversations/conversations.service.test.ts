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
                  context: { text: "", supporting_items: [] },
                  decision: { text: "", rationale: "", supporting_items: [] },
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

  describe("getTopicForReview", () => {
    test("returns the first unreviewed topic with combined idea units", async () => {
      const workingDir = mkdtempSync(join(tmpdir(), "noesis-review-"));
      try {
        const conv = {
          conversation_id: "rev-1",
          time: "2026-04-17T10:00:00Z",
          main_topic: "Review",
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
              id: "r-topic",
              title: "Topic",
              short_summary: "s",
              long_summary: "",
              items: [
                {
                  type: "idea_unit_ref",
                  conversation_id: "rev-1",
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
        await writeFile(
          join(workingDir, "output.json"),
          JSON.stringify({ conversation: conv, potential_topics: { topics: [] } }),
        );

        const review = await conversations.getTopicForReview(
          join(workingDir, "output.json"),
        );
        expect(review).not.toBeNull();
        expect(review!.topic_id).toBe("r-topic");
        expect(review!.num_items).toBe(1);
        expect(review!.has_decision_units).toBe(false);
        expect(review!.markdown).toContain("# Topic");
        expect(review!.markdown).toContain("hello");
      } finally {
        rmSync(workingDir, { recursive: true, force: true });
      }
    });

    test("returns null when all topics are reviewed", async () => {
      const workingDir = mkdtempSync(join(tmpdir(), "noesis-review-"));
      try {
        const conv = {
          conversation_id: "rev-2",
          time: "2026-04-17T10:00:00Z",
          main_topic: "Review",
          turns: [],
          topics: [
            {
              id: "t",
              title: "T",
              short_summary: "",
              long_summary: "",
              items: [],
              decisions: [],
              reviewed: true,
              decisions_extracted: true,
            },
          ],
        };
        await writeFile(
          join(workingDir, "output.json"),
          JSON.stringify({ conversation: conv, potential_topics: { topics: [] } }),
        );

        const review = await conversations.getTopicForReview(
          join(workingDir, "output.json"),
        );
        expect(review).toBeNull();
      } finally {
        rmSync(workingDir, { recursive: true, force: true });
      }
    });
  });
});
