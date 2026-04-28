import { describe, expect, test } from "bun:test";
import {
  validateAnalyzeConversationOutput,
  type GraphLookup,
  type ValidationResult,
} from "./validate-output.js";

class FakeGraph implements GraphLookup {
  constructor(private readonly existing: Set<string> = new Set()) {}
  async topicExists(id: string): Promise<boolean> {
    return this.existing.has(id);
  }
}

function ideaUnitRef(
  conversationId: string,
  turnIndex: number,
  ideaUnitIndex: number,
): unknown {
  return {
    type: "idea_unit_ref",
    conversation_id: conversationId,
    turn_index: turnIndex,
    idea_unit_index: ideaUnitIndex,
  };
}

function baseOutput(
  overrides: Partial<{
    turns: unknown[];
    topics: unknown[];
    potentialTopics: unknown[];
    conversationId: string;
  }> = {},
): unknown {
  return {
    conversation: {
      conversation_id: overrides.conversationId ?? "c1",
      time: "2026-04-17T10:00:00Z",
      main_topic: "T",
      turns: overrides.turns ?? [],
      topics: overrides.topics ?? [],
    },
    potential_topics: { topics: overrides.potentialTopics ?? [] },
  };
}

function topic(id: string, items: unknown[] = [], decisions: unknown[] = []) {
  return {
    id,
    title: id,
    short_summary: "",
    long_summary: "",
    items,
    decisions,
    reviewed: false,
    decisions_extracted: false,
  };
}

function potential(
  id: string,
  parentId: string | null = null,
  isNew = true,
) {
  return {
    id,
    title: id,
    short_summary: "",
    path: [id],
    is_new: isNew,
    parent_id: parentId,
  };
}

function turn(index: number, ideaUnits: unknown[]) {
  return {
    index,
    speaker: "alice",
    time: "00:00:00",
    idea_units: ideaUnits,
  };
}

function ideaUnit(index: number, categories: string[] = ["Information"]) {
  return { index, sentences: ["x"], categories };
}

function expectOk(result: ValidationResult): void {
  if (result.status !== "Ok") {
    throw new Error(
      `Expected Ok, got Errors: ${JSON.stringify(result.errors, null, 2)}`,
    );
  }
}

describe("validateAnalyzeConversationOutput", () => {
  test("returns Ok for a minimally valid output", async () => {
    const out = baseOutput({
      turns: [turn(0, [ideaUnit(0)])],
      topics: [topic("t1", [ideaUnitRef("c1", 0, 0)])],
      potentialTopics: [potential("t1")],
    });
    const result = await validateAnalyzeConversationOutput(out, new FakeGraph());
    expectOk(result);
  });

  test("flags non-Irrelevant idea units that are unassigned", async () => {
    const out = baseOutput({
      turns: [turn(0, [ideaUnit(0), ideaUnit(1)])],
      topics: [topic("t1", [ideaUnitRef("c1", 0, 0)])],
      potentialTopics: [potential("t1")],
    });
    const result = await validateAnalyzeConversationOutput(out, new FakeGraph());
    expect(result.status).toBe("Errors");
    if (result.status !== "Errors") return;
    expect(
      result.errors.some((e) =>
        e.message.includes("not assigned to any topic"),
      ),
    ).toBe(true);
  });

  test("flags Irrelevant idea units that are assigned", async () => {
    const out = baseOutput({
      turns: [turn(0, [ideaUnit(0, ["Irrelevant"])])],
      topics: [topic("t1", [ideaUnitRef("c1", 0, 0)])],
      potentialTopics: [potential("t1")],
    });
    const result = await validateAnalyzeConversationOutput(out, new FakeGraph());
    expect(result.status).toBe("Errors");
    if (result.status !== "Errors") return;
    expect(
      result.errors.some((e) => e.message.includes("Irrelevant")),
    ).toBe(true);
  });

  test("flags duplicate assignments of the same idea unit", async () => {
    const out = baseOutput({
      turns: [turn(0, [ideaUnit(0)])],
      topics: [
        topic("t1", [ideaUnitRef("c1", 0, 0)]),
        topic("t2", [ideaUnitRef("c1", 0, 0)]),
      ],
      potentialTopics: [potential("t1"), potential("t2")],
    });
    const result = await validateAnalyzeConversationOutput(out, new FakeGraph());
    expect(result.status).toBe("Errors");
    if (result.status !== "Errors") return;
    expect(
      result.errors.some((e) => e.message.includes("assigned 2 times")),
    ).toBe(true);
  });

  test("flags new topic missing from potential_topics", async () => {
    const out = baseOutput({
      turns: [turn(0, [ideaUnit(0)])],
      topics: [topic("t1", [ideaUnitRef("c1", 0, 0)])],
      potentialTopics: [],
    });
    const result = await validateAnalyzeConversationOutput(out, new FakeGraph());
    expect(result.status).toBe("Errors");
    if (result.status !== "Errors") return;
    expect(
      result.errors.some((e) => e.message.includes("not in the graph")),
    ).toBe(true);
  });

  test("accepts existing graph topic without is_new entry", async () => {
    const out = baseOutput({
      turns: [turn(0, [ideaUnit(0)])],
      topics: [topic("existing", [ideaUnitRef("c1", 0, 0)])],
      potentialTopics: [
        {
          id: "existing",
          title: "existing",
          short_summary: "",
          path: ["existing"],
          is_new: false,
          parent_id: null,
        },
      ],
    });
    const result = await validateAnalyzeConversationOutput(
      out,
      new FakeGraph(new Set(["existing"])),
    );
    expectOk(result);
  });

  test("flags is_new without a matching conversation.topics entry", async () => {
    const out = baseOutput({
      turns: [turn(0, [ideaUnit(0)])],
      topics: [topic("t1", [ideaUnitRef("c1", 0, 0)])],
      potentialTopics: [potential("t1"), potential("ghost")],
    });
    const result = await validateAnalyzeConversationOutput(out, new FakeGraph());
    expect(result.status).toBe("Errors");
    if (result.status !== "Errors") return;
    expect(
      result.errors.some((e) =>
        e.message.includes('id="ghost" is marked is_new'),
      ),
    ).toBe(true);
  });

  test("flags references to non-existent idea units", async () => {
    const out = baseOutput({
      turns: [turn(0, [ideaUnit(0)])],
      topics: [topic("t1", [ideaUnitRef("c1", 0, 0), ideaUnitRef("c1", 5, 9)])],
      potentialTopics: [potential("t1")],
    });
    const result = await validateAnalyzeConversationOutput(out, new FakeGraph());
    expect(result.status).toBe("Errors");
    if (result.status !== "Errors") return;
    expect(
      result.errors.some((e) =>
        e.message.includes("does not exist in conversation.turns"),
      ),
    ).toBe(true);
  });

  test("flags topic items referencing other conversations", async () => {
    const out = baseOutput({
      turns: [turn(0, [ideaUnit(0)])],
      topics: [
        topic("t1", [ideaUnitRef("c1", 0, 0), ideaUnitRef("other", 0, 0)]),
      ],
      potentialTopics: [potential("t1")],
    });
    const result = await validateAnalyzeConversationOutput(out, new FakeGraph());
    expect(result.status).toBe("Errors");
    if (result.status !== "Errors") return;
    expect(
      result.errors.some((e) =>
        e.message.includes("current conversation's idea units only"),
      ),
    ).toBe(true);
  });

  test("flags parent_id pointing nowhere", async () => {
    const out = baseOutput({
      turns: [turn(0, [ideaUnit(0)])],
      topics: [topic("t1", [ideaUnitRef("c1", 0, 0)])],
      potentialTopics: [potential("t1", "missing-parent")],
    });
    const result = await validateAnalyzeConversationOutput(out, new FakeGraph());
    expect(result.status).toBe("Errors");
    if (result.status !== "Errors") return;
    expect(
      result.errors.some((e) =>
        e.message.includes('parent_id="missing-parent"'),
      ),
    ).toBe(true);
  });

  test("accepts parent_id pointing at an existing graph topic", async () => {
    const out = baseOutput({
      turns: [turn(0, [ideaUnit(0)])],
      topics: [topic("t1", [ideaUnitRef("c1", 0, 0)])],
      potentialTopics: [potential("t1", "parent-in-graph")],
    });
    const result = await validateAnalyzeConversationOutput(
      out,
      new FakeGraph(new Set(["parent-in-graph"])),
    );
    expectOk(result);
  });

  test("flags cycles in topic forest", async () => {
    const out = baseOutput({
      turns: [turn(0, [ideaUnit(0)])],
      topics: [
        topic("a", [ideaUnitRef("c1", 0, 0)]),
        topic("b"),
      ],
      potentialTopics: [potential("a", "b"), potential("b", "a")],
    });
    const result = await validateAnalyzeConversationOutput(out, new FakeGraph());
    expect(result.status).toBe("Errors");
    if (result.status !== "Errors") return;
    expect(result.errors.some((e) => e.message.includes("Cycle"))).toBe(true);
  });

  test("emits warning when first-level breadth exceeds threshold", async () => {
    const turns = Array.from({ length: 11 }, (_, i) =>
      turn(i, [ideaUnit(0)]),
    );
    const topics = Array.from({ length: 11 }, (_, i) =>
      topic(`t${i}`, [ideaUnitRef("c1", i, 0)]),
    );
    const potentialTopics = Array.from({ length: 11 }, (_, i) =>
      potential(`t${i}`),
    );
    const out = baseOutput({ turns, topics, potentialTopics });
    const result = await validateAnalyzeConversationOutput(out, new FakeGraph());
    expectOk(result);
    expect(
      result.warnings.some((w) =>
        w.message.includes("First-level breadth is 11"),
      ),
    ).toBe(true);
  });

  test("emits warning when a topic has more than 25 own items", async () => {
    const ius = Array.from({ length: 26 }, (_, i) => ideaUnit(i));
    const refs = Array.from({ length: 26 }, (_, i) => ideaUnitRef("c1", 0, i));
    const out = baseOutput({
      turns: [turn(0, ius)],
      topics: [topic("t1", refs)],
      potentialTopics: [potential("t1")],
    });
    const result = await validateAnalyzeConversationOutput(out, new FakeGraph());
    expectOk(result);
    expect(
      result.warnings.some((w) => w.message.includes("has 26 own items")),
    ).toBe(true);
  });

  test("does not emit own-items warning at exactly the threshold", async () => {
    const ius = Array.from({ length: 25 }, (_, i) => ideaUnit(i));
    const refs = Array.from({ length: 25 }, (_, i) => ideaUnitRef("c1", 0, i));
    const out = baseOutput({
      turns: [turn(0, ius)],
      topics: [topic("t1", refs)],
      potentialTopics: [potential("t1")],
    });
    const result = await validateAnalyzeConversationOutput(out, new FakeGraph());
    expectOk(result);
    expect(
      result.warnings.some((w) => w.message.includes("own items")),
    ).toBe(false);
  });

  test("returns Errors with a clear path for schema violations", async () => {
    const out = {
      conversation: {
        conversation_id: "c1",
      },
    };
    const result = await validateAnalyzeConversationOutput(out, new FakeGraph());
    expect(result.status).toBe("Errors");
    if (result.status !== "Errors") return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toHaveProperty("path");
    expect(result.errors[0]).toHaveProperty("message");
  });

  test("flags decision references to nonexistent idea units", async () => {
    const out = baseOutput({
      turns: [turn(0, [ideaUnit(0, ["Decision"])])],
      topics: [
        topic(
          "t1",
          [ideaUnitRef("c1", 0, 0)],
          [
            {
              title: "d",
              status: "accepted",
              referenced_items: [ideaUnitRef("c1", 9, 9)],
              context: { text: "", supporting_item_indices: [0] },
              decision: { text: "", rationale: "", supporting_item_indices: [] },
              alternative_options: [],
            },
          ],
        ),
      ],
      potentialTopics: [potential("t1")],
    });
    const result = await validateAnalyzeConversationOutput(out, new FakeGraph());
    expect(result.status).toBe("Errors");
    if (result.status !== "Errors") return;
    expect(
      result.errors.some(
        (e) =>
          e.message.includes("Decision referenced_items[0]") &&
          e.message.includes("does not exist"),
      ),
    ).toBe(true);
  });
});
