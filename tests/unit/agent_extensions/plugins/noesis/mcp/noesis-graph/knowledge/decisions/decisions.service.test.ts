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
import { DecisionsService } from "@noesis/mcp/noesis-graph/knowledge/decisions/decisions.service.js";
import { TopicsService } from "@noesis/mcp/noesis-graph/knowledge/topics/topics.service.js";

describe("DecisionsService — recording decisions, alternatives, and supporting links", () => {
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

  test("adding a decision creates the node, its alternatives, and per-slot supporting links", async () => {
    let id: string;

    await given(
      "a topic and a conversation whose idea units back the new decision",
      async () => {
        const convPath = join(ctx.tmpDir, "conv.json");
        await writeFile(
          convPath,
          JSON.stringify(sampleConversation("conv-1")),
        );
        await conversations.addConversationFromFile(convPath);
        await topics.addTopic({ id: "t1", title: "T", short_summary: "" });
      },
    );
    await when(
      "the service records a decision with one alternative and supporting indices for each slot",
      async () => {
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
        ({ id } = await decisions.addDecision("t1", {
          id: "dec-1",
          title: "Pick Postgres",
          status: "accepted",
          referenced_items: [iuContext, iuDecision, iuAlt],
          context: { text: "We need a DB.", supporting_item_indices: [0] },
          decision: {
            text: "Use Postgres.",
            rationale: "Team knows it.",
            supporting_item_indices: [1],
          },
          alternative_options: [
            {
              text: "Use MySQL.",
              rationale: "Slightly faster.",
              supporting_item_indices: [2],
            },
          ],
        }));
      },
    );
    await then("the returned id matches the requested decision id", () => {
      expect(id).toBe("dec-1");
    });
    await and(
      "the decision is linked to its topic, has one alternative, and three slot edges",
      async () => {
        expect(await countRels(ctx.db, "TOPIC_HAS_DECISION")).toBe(1);
        expect(await countNodes(ctx.db, "AlternativeOption")).toBe(1);
        expect(await countRels(ctx.db, "DECISION_HAS_ALTERNATIVE")).toBe(1);
        expect(await countRels(ctx.db, "CONTEXT_SUPPORTED_BY_IDEA_UNIT")).toBe(1);
        expect(await countRels(ctx.db, "DECISION_SUPPORTED_BY_IDEA_UNIT")).toBe(1);
        expect(
          await countRels(ctx.db, "ALTERNATIVE_SUPPORTED_BY_IDEA_UNIT"),
        ).toBe(1);
      },
    );
  });

  test("a single referenced idea unit can support multiple slots without duplication", async () => {
    await given(
      "a topic and a single conversation idea unit referenced from every slot",
      async () => {
        const convPath = join(ctx.tmpDir, "conv-dedup.json");
        await writeFile(
          convPath,
          JSON.stringify(sampleConversation("conv-dedup")),
        );
        await conversations.addConversationFromFile(convPath);
        await topics.addTopic({
          id: "t-dedup",
          title: "T",
          short_summary: "",
        });
      },
    );
    await when(
      "a decision is recorded that points all three slots at the same idea unit",
      async () => {
        const iu = {
          type: "idea_unit_ref" as const,
          conversation_id: "conv-dedup",
          turn_index: 0,
          idea_unit_index: 0,
        };
        await decisions.addDecision("t-dedup", {
          id: "dec-shared",
          title: "Shared item",
          status: "accepted",
          referenced_items: [iu],
          context: { text: "", supporting_item_indices: [0] },
          decision: { text: "", rationale: "", supporting_item_indices: [0] },
          alternative_options: [
            { text: "alt", rationale: "", supporting_item_indices: [0] },
          ],
        });
      },
    );
    await then(
      "exactly one supporting edge of each kind connects the slot to the unit",
      async () => {
        expect(await countRels(ctx.db, "CONTEXT_SUPPORTED_BY_IDEA_UNIT")).toBe(1);
        expect(await countRels(ctx.db, "DECISION_SUPPORTED_BY_IDEA_UNIT")).toBe(1);
        expect(
          await countRels(ctx.db, "ALTERNATIVE_SUPPORTED_BY_IDEA_UNIT"),
        ).toBe(1);
      },
    );
  });

  test("adding a decision with an unknown supporting idea unit fails fast", async () => {
    let thrown: Error | null = null;

    await given("a topic with no recorded conversations", async () => {
      await topics.addTopic({ id: "t1", title: "T", short_summary: "" });
    });
    await when(
      "the caller adds a decision referencing an idea unit from a non-existent conversation",
      async () => {
        try {
          await decisions.addDecision("t1", {
            id: "dec-1",
            title: "X",
            status: "proposed",
            referenced_items: [
              {
                type: "idea_unit_ref",
                conversation_id: "ghost",
                turn_index: 0,
                idea_unit_index: 0,
              },
            ],
            context: { text: "", supporting_item_indices: [0] },
            decision: { text: "", rationale: "", supporting_item_indices: [] },
            alternative_options: [],
          });
        } catch (e) {
          thrown = e as Error;
        }
      },
    );
    await then("the operation fails with a 'not found' error for the missing unit", () => {
      expect(thrown?.message).toMatch(/Idea unit not found/);
    });
  });

  test("adding a decision under a missing topic fails before any node is written", async () => {
    let thrown: Error | null = null;

    await given("an empty topic graph", () => {});
    await when("the caller tries to attach a decision to a non-existent topic", async () => {
      try {
        await decisions.addDecision("missing", {
          id: "dec-1",
          title: "X",
          status: "proposed",
          referenced_items: [],
          context: { text: "", supporting_item_indices: [] },
          decision: { text: "", rationale: "", supporting_item_indices: [] },
          alternative_options: [],
        });
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the operation fails with a topic-not-found error", () => {
      expect(thrown?.message).toMatch(/Topic not found/);
    });
  });

  test("addItemsToDecisionSlot routes new items to the requested slot", async () => {
    await given(
      "a decision with one alternative and a recorded idea unit available for linking",
      async () => {
        const convPath = join(ctx.tmpDir, "conv.json");
        await writeFile(
          convPath,
          JSON.stringify(sampleConversation("conv-1")),
        );
        await conversations.addConversationFromFile(convPath);
        await topics.addTopic({ id: "t1", title: "T", short_summary: "" });
        await decisions.addDecision("t1", {
          id: "dec-1",
          title: "X",
          status: "proposed",
          referenced_items: [],
          context: { text: "", supporting_item_indices: [] },
          decision: { text: "", rationale: "", supporting_item_indices: [] },
          alternative_options: [
            { text: "Alt", rationale: "", supporting_item_indices: [] },
          ],
        });
      },
    );
    await when(
      "the same idea unit is added to context, decision, and alternative slots",
      async () => {
        const iu = {
          type: "idea_unit_ref" as const,
          conversation_id: "conv-1",
          turn_index: 0,
          idea_unit_index: 0,
        };
        await decisions.addItemsToDecisionSlot("dec-1", { slot: "context" }, [
          iu,
        ]);
        await decisions.addItemsToDecisionSlot("dec-1", { slot: "decision" }, [
          iu,
        ]);
        await decisions.addItemsToDecisionSlot(
          "dec-1",
          { slot: "alternative", alternative_index: 0 },
          [iu],
        );
      },
    );
    await then(
      "each slot has exactly one supporting-by-idea-unit edge to the unit",
      async () => {
        expect(await countRels(ctx.db, "CONTEXT_SUPPORTED_BY_IDEA_UNIT")).toBe(1);
        expect(await countRels(ctx.db, "DECISION_SUPPORTED_BY_IDEA_UNIT")).toBe(1);
        expect(
          await countRels(ctx.db, "ALTERNATIVE_SUPPORTED_BY_IDEA_UNIT"),
        ).toBe(1);
      },
    );
  });

  test("addItemsToDecisionSlot rejects an out-of-range alternative index", async () => {
    let thrown: Error | null = null;

    await given("a decision that has no alternative options", async () => {
      await topics.addTopic({ id: "t1", title: "T", short_summary: "" });
      await decisions.addDecision("t1", {
        id: "dec-1",
        title: "X",
        status: "proposed",
        referenced_items: [],
        context: { text: "", supporting_item_indices: [] },
        decision: { text: "", rationale: "", supporting_item_indices: [] },
        alternative_options: [],
      });
    });
    await when("the caller targets an alternative slot at index 5", async () => {
      try {
        await decisions.addItemsToDecisionSlot(
          "dec-1",
          { slot: "alternative", alternative_index: 5 },
          [],
        );
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the request fails with an alternative-not-found error", () => {
      expect(thrown?.message).toMatch(/Alternative option not found/);
    });
  });

  test("listDecisions filters by topic and returns everything when called with null", async () => {
    let all: Awaited<ReturnType<DecisionsService["listDecisions"]>>;
    let onlyA: Awaited<ReturnType<DecisionsService["listDecisions"]>>;

    await given("two topics each with one stored decision", async () => {
      await topics.addTopic({ id: "t-a", title: "A", short_summary: "" });
      await topics.addTopic({ id: "t-b", title: "B", short_summary: "" });
      await decisions.addDecision("t-a", {
        id: "dec-a-1",
        title: "A1",
        status: "accepted",
        referenced_items: [],
        context: { text: "ctx", supporting_item_indices: [] },
        decision: { text: "do", rationale: "r", supporting_item_indices: [] },
        alternative_options: [],
      });
      await decisions.addDecision("t-b", {
        id: "dec-b-1",
        title: "B1",
        status: "proposed",
        referenced_items: [],
        context: { text: "", supporting_item_indices: [] },
        decision: { text: "", rationale: "", supporting_item_indices: [] },
        alternative_options: [],
      });
    });
    await when(
      "the consumer lists decisions twice — unfiltered and scoped to topic A",
      async () => {
        all = await decisions.listDecisions(null);
        onlyA = await decisions.listDecisions("t-a");
      },
    );
    await then("the unfiltered list contains both decisions", () => {
      expect(all).toHaveLength(2);
    });
    await and("the topic-scoped list contains only the decision under A", () => {
      expect(onlyA).toHaveLength(1);
      expect(onlyA[0].id).toBe("dec-a-1");
    });
  });

  test("readDecision returns the full record including alternatives, or null when absent", async () => {
    let detail: Awaited<ReturnType<DecisionsService["readDecision"]>>;
    let missing: Awaited<ReturnType<DecisionsService["readDecision"]>>;

    await given("a stored decision with one alternative option", async () => {
      await topics.addTopic({ id: "t-c", title: "C", short_summary: "" });
      await decisions.addDecision("t-c", {
        id: "dec-c-1",
        title: "C1",
        status: "accepted",
        referenced_items: [],
        context: { text: "ctx", supporting_item_indices: [] },
        decision: { text: "do", rationale: "because", supporting_item_indices: [] },
        alternative_options: [
          { text: "alt1", rationale: "r1", supporting_item_indices: [] },
        ],
      });
    });
    await when("the caller reads both an existing and an unknown decision", async () => {
      detail = await decisions.readDecision("dec-c-1");
      missing = await decisions.readDecision("ghost");
    });
    await then("the existing decision returns its title, context, and alternatives", () => {
      expect(detail).not.toBeNull();
      expect(detail!.title).toBe("C1");
      expect(detail!.context_text).toBe("ctx");
      expect(detail!.alternatives).toHaveLength(1);
      expect(detail!.alternatives[0].text).toBe("alt1");
    });
    await and("the unknown id returns null", () => {
      expect(missing).toBeNull();
    });
  });

  test("updateDecisionEditableFields rejects an empty title", async () => {
    let thrown: Error | null = null;

    await given("a stored decision", async () => {
      await topics.addTopic({ id: "t-x", title: "X", short_summary: "" });
      await decisions.addDecision("t-x", {
        id: "dec-x-1",
        title: "Has title",
        status: "proposed",
        referenced_items: [],
        context: { text: "", supporting_item_indices: [] },
        decision: { text: "", rationale: "", supporting_item_indices: [] },
        alternative_options: [],
      });
    });
    await when("the caller tries to overwrite the title with whitespace only", async () => {
      try {
        await decisions.updateDecisionEditableFields("dec-x-1", { title: "   " });
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the operation fails because decision titles must not be empty", () => {
      expect(thrown?.message).toMatch(/title must not be empty/);
    });
  });
});
