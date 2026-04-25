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
import { TopicsService } from "../topics/topics.service.js";
import { DecisionsService } from "./decisions.service.js";
import { alternativeOptionNodeId } from "./node-ids.js";

describe("DecisionsService", () => {
  let ctx: KnowledgeTestContext;
  let decisions: DecisionsService;
  let topics: TopicsService;
  let conversations: ConversationsService;

  beforeAll(async () => {
    ctx = await createKnowledgeTestModule();
    decisions = ctx.module.get(DecisionsService);
    topics = ctx.module.get(TopicsService);
    conversations = ctx.module.get(ConversationsService);
  });

  afterAll(async () => {
    await ctx.module.close();
    rmSync(ctx.tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await clearGraph(ctx.db);
  });

  describe("addDecision", () => {
    test("creates Decision, Alternatives, and per-slot supporting edges", async () => {
      const convPath = join(ctx.tmpDir, "conv.json");
      await writeFile(convPath, JSON.stringify(sampleConversation("conv-1")));
      await conversations.addConversationFromFile(convPath);
      await topics.addTopic({ id: "t1", title: "T", short_summary: "" });

      const iuContext = {
        type: "idea_unit_ref" as const,
        conversation_id: "conv-1",
        turn_index: 0,
        idea_unit_index: 0,
      };
      const iuDecision = {
        type: "idea_unit_ref" as const,
        conversation_id: "conv-1",
        turn_index: 0,
        idea_unit_index: 1,
      };
      const iuAlt = {
        type: "idea_unit_ref" as const,
        conversation_id: "conv-1",
        turn_index: 1,
        idea_unit_index: 0,
      };

      const { id } = await decisions.addDecision("t1", {
        id: "dec-1",
        title: "Pick Postgres",
        status: "accepted",
        context: { text: "We need a DB.", supporting_items: [iuContext] },
        decision: {
          text: "Use Postgres.",
          rationale: "Team knows it.",
          supporting_items: [iuDecision],
        },
        alternative_options: [
          {
            text: "Use MySQL.",
            rationale: "Slightly faster.",
            supporting_items: [iuAlt],
          },
        ],
      });

      expect(id).toBe("dec-1");
      expect(await countRels(ctx.db, "TOPIC_HAS_DECISION")).toBe(1);
      expect(await countNodes(ctx.db, "AlternativeOption")).toBe(1);
      expect(await countRels(ctx.db, "DECISION_HAS_ALTERNATIVE")).toBe(1);
      expect(await countRels(ctx.db, "CONTEXT_SUPPORTED_BY_IDEA_UNIT")).toBe(1);
      expect(await countRels(ctx.db, "DECISION_SUPPORTED_BY_IDEA_UNIT")).toBe(1);
      expect(await countRels(ctx.db, "ALTERNATIVE_SUPPORTED_BY_IDEA_UNIT")).toBe(1);

      const expectedAltId = alternativeOptionNodeId("dec-1", 0);
      const alt = await ctx.db
        .getConnection()
        .query(
          `MATCH (a:AlternativeOption {id: '${expectedAltId}'}) RETURN a.option_index AS idx`,
        );
      expect(asArray(alt).getAllSync()).toEqual([{ idx: 0 }]);
    });

    test("fails when referenced idea unit is missing", async () => {
      await topics.addTopic({ id: "t1", title: "T", short_summary: "" });
      await expect(
        decisions.addDecision("t1", {
          id: "dec-1",
          title: "X",
          status: "proposed",
          context: {
            text: "",
            supporting_items: [
              {
                type: "idea_unit_ref",
                conversation_id: "ghost",
                turn_index: 0,
                idea_unit_index: 0,
              },
            ],
          },
          decision: { text: "", rationale: "", supporting_items: [] },
          alternative_options: [],
        }),
      ).rejects.toThrow(/Idea unit not found/);
    });

    test("fails when target topic is missing", async () => {
      await expect(
        decisions.addDecision("missing", {
          id: "dec-1",
          title: "X",
          status: "proposed",
          context: { text: "", supporting_items: [] },
          decision: { text: "", rationale: "", supporting_items: [] },
          alternative_options: [],
        }),
      ).rejects.toThrow(/Topic not found/);
    });
  });

  describe("addItemsToDecisionSlot", () => {
    test("routes items to the correct slot", async () => {
      const convPath = join(ctx.tmpDir, "conv.json");
      await writeFile(convPath, JSON.stringify(sampleConversation("conv-1")));
      await conversations.addConversationFromFile(convPath);
      await topics.addTopic({ id: "t1", title: "T", short_summary: "" });
      await decisions.addDecision("t1", {
        id: "dec-1",
        title: "X",
        status: "proposed",
        context: { text: "", supporting_items: [] },
        decision: { text: "", rationale: "", supporting_items: [] },
        alternative_options: [
          { text: "Alt", rationale: "", supporting_items: [] },
        ],
      });

      const iu = {
        type: "idea_unit_ref" as const,
        conversation_id: "conv-1",
        turn_index: 0,
        idea_unit_index: 0,
      };

      await decisions.addItemsToDecisionSlot("dec-1", { slot: "context" }, [iu]);
      await decisions.addItemsToDecisionSlot("dec-1", { slot: "decision" }, [iu]);
      await decisions.addItemsToDecisionSlot(
        "dec-1",
        { slot: "alternative", alternative_index: 0 },
        [iu],
      );

      expect(await countRels(ctx.db, "CONTEXT_SUPPORTED_BY_IDEA_UNIT")).toBe(1);
      expect(await countRels(ctx.db, "DECISION_SUPPORTED_BY_IDEA_UNIT")).toBe(1);
      expect(await countRels(ctx.db, "ALTERNATIVE_SUPPORTED_BY_IDEA_UNIT")).toBe(1);
    });

    test("fails when alternative index does not exist", async () => {
      await topics.addTopic({ id: "t1", title: "T", short_summary: "" });
      await decisions.addDecision("t1", {
        id: "dec-1",
        title: "X",
        status: "proposed",
        context: { text: "", supporting_items: [] },
        decision: { text: "", rationale: "", supporting_items: [] },
        alternative_options: [],
      });

      await expect(
        decisions.addItemsToDecisionSlot(
          "dec-1",
          { slot: "alternative", alternative_index: 5 },
          [],
        ),
      ).rejects.toThrow(/Alternative option not found/);
    });
  });

  describe("listDecisions / readDecision", () => {
    test("listDecisions returns decisions filtered by topic and unfiltered", async () => {
      await topics.addTopic({ id: "t-a", title: "A", short_summary: "" });
      await topics.addTopic({ id: "t-b", title: "B", short_summary: "" });
      await decisions.addDecision("t-a", {
        id: "dec-a-1",
        title: "A1",
        status: "accepted",
        context: { text: "ctx", supporting_items: [] },
        decision: { text: "do", rationale: "r", supporting_items: [] },
        alternative_options: [],
      });
      await decisions.addDecision("t-b", {
        id: "dec-b-1",
        title: "B1",
        status: "proposed",
        context: { text: "", supporting_items: [] },
        decision: { text: "", rationale: "", supporting_items: [] },
        alternative_options: [],
      });

      const all = await decisions.listDecisions(null);
      expect(all).toHaveLength(2);
      const onlyA = await decisions.listDecisions("t-a");
      expect(onlyA).toHaveLength(1);
      expect(onlyA[0].id).toBe("dec-a-1");
    });

    test("readDecision returns full detail with alternatives", async () => {
      await topics.addTopic({ id: "t-c", title: "C", short_summary: "" });
      await decisions.addDecision("t-c", {
        id: "dec-c-1",
        title: "C1",
        status: "accepted",
        context: { text: "ctx", supporting_items: [] },
        decision: { text: "do", rationale: "because", supporting_items: [] },
        alternative_options: [
          { text: "alt1", rationale: "r1", supporting_items: [] },
        ],
      });
      const detail = await decisions.readDecision("dec-c-1");
      expect(detail).not.toBeNull();
      expect(detail!.title).toBe("C1");
      expect(detail!.context_text).toBe("ctx");
      expect(detail!.alternatives).toHaveLength(1);
      expect(detail!.alternatives[0].text).toBe("alt1");
      expect(await decisions.readDecision("ghost")).toBeNull();
    });
  });
});
