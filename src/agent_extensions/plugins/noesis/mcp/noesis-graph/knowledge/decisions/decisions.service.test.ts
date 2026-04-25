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

  describe("getDecisionsPage", () => {
    test("returns decisions sorted by source date desc with derived dates", async () => {
      const convPath = join(ctx.tmpDir, "conv-page.json");
      await writeFile(
        convPath,
        JSON.stringify(sampleConversation("conv-page-1")),
      );
      await conversations.addConversationFromFile(convPath);
      await topics.addTopic({ id: "t-page", title: "T", short_summary: "" });

      const iu = {
        type: "idea_unit_ref" as const,
        conversation_id: "conv-page-1",
        turn_index: 0,
        idea_unit_index: 0,
      };

      await decisions.addDecision("t-page", {
        id: "dec-with-date",
        title: "Has date",
        status: "accepted",
        context: { text: "c", supporting_items: [iu] },
        decision: { text: "d", rationale: "", supporting_items: [] },
        alternative_options: [],
      });
      await decisions.addDecision("t-page", {
        id: "dec-no-date",
        title: "No date",
        status: "proposed",
        context: { text: "c", supporting_items: [] },
        decision: { text: "d", rationale: "", supporting_items: [] },
        alternative_options: [],
      });

      const page = await decisions.getDecisionsPage();
      expect(page.decisions).toHaveLength(2);
      expect(page.decisions[0].id).toBe("dec-with-date");
      expect(page.decisions[0].date).not.toBe("");
      expect(page.decisions[1].id).toBe("dec-no-date");
      expect(page.decisions[1].date).toBe("");
    });
  });

  describe("getDecisionDetail", () => {
    test("returns formatted detail data with derived date", async () => {
      const convPath = join(ctx.tmpDir, "conv-det.json");
      await writeFile(
        convPath,
        JSON.stringify(sampleConversation("conv-det-1")),
      );
      await conversations.addConversationFromFile(convPath);
      await topics.addTopic({ id: "t-det", title: "Topic D", short_summary: "" });

      const iu = {
        type: "idea_unit_ref" as const,
        conversation_id: "conv-det-1",
        turn_index: 0,
        idea_unit_index: 0,
      };

      await decisions.addDecision("t-det", {
        id: "dec-det-1",
        title: "Detail",
        status: "accepted",
        context: { text: "ctx text", supporting_items: [iu] },
        decision: {
          text: "decision text",
          rationale: "because",
          supporting_items: [],
        },
        alternative_options: [
          { text: "alt 0", rationale: "r0", supporting_items: [] },
        ],
      });

      const detail = await decisions.getDecisionDetail("dec-det-1");
      expect(detail.id).toBe("dec-det-1");
      expect(detail.topic_title).toBe("Topic D");
      expect(detail.status).toBe("accepted");
      expect(detail.context_text).toBe("ctx text");
      expect(detail.decision_text).toBe("decision text");
      expect(detail.decision_rationale).toBe("because");
      expect(detail.alternatives).toHaveLength(1);
      expect(detail.alternatives[0].text).toBe("alt 0");
      expect(detail.date).not.toBe("");
    });

    test("throws on missing decision", async () => {
      await expect(decisions.getDecisionDetail("ghost")).rejects.toThrow(
        /not found/,
      );
    });
  });

  describe("listDecisionsForSources", () => {
    test("returns decisions whose supporting items reference the given conversations", async () => {
      const convPath = join(ctx.tmpDir, "conv-src-1.json");
      await writeFile(
        convPath,
        JSON.stringify(sampleConversation("conv-src-1")),
      );
      await conversations.addConversationFromFile(convPath);
      await topics.addTopic({ id: "t-src", title: "T", short_summary: "" });

      const iu = {
        type: "idea_unit_ref" as const,
        conversation_id: "conv-src-1",
        turn_index: 0,
        idea_unit_index: 0,
      };

      await decisions.addDecision("t-src", {
        id: "dec-src-1",
        title: "Source-linked",
        status: "accepted",
        context: { text: "c", supporting_items: [iu] },
        decision: { text: "d", rationale: "", supporting_items: [] },
        alternative_options: [],
      });
      await decisions.addDecision("t-src", {
        id: "dec-other",
        title: "Unlinked",
        status: "proposed",
        context: { text: "", supporting_items: [] },
        decision: { text: "", rationale: "", supporting_items: [] },
        alternative_options: [],
      });

      const rows = await decisions.listDecisionsForSources(
        ["conv-src-1"],
        [],
      );
      expect(rows.map((r) => r.id)).toEqual(["dec-src-1"]);
      expect(rows[0].context_text).toBe("c");
    });

    test("returns empty list when no sources match", async () => {
      const rows = await decisions.listDecisionsForSources(["ghost"], []);
      expect(rows).toEqual([]);
    });
  });
});
