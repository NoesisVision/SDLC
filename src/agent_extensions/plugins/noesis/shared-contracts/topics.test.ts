import { describe, expect, test } from "bun:test";
import { DecisionSchema } from "./topics.js";

describe("DecisionSchema", () => {
  const ideaUnitRef = {
    type: "idea_unit_ref" as const,
    conversation_id: "c1",
    turn_index: 0,
    idea_unit_index: 0,
  };

  test("fills id with a uuid when omitted", () => {
    const result = DecisionSchema.parse({
      title: "t",
      status: "accepted",
      referenced_items: [],
      context: { text: "", supporting_item_indices: [] },
      decision: { text: "", rationale: "", supporting_item_indices: [] },
      alternative_options: [],
    });
    expect(result.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test("accepts indices that point inside referenced_items", () => {
    const result = DecisionSchema.parse({
      title: "t",
      status: "accepted",
      referenced_items: [ideaUnitRef, ideaUnitRef],
      context: { text: "", supporting_item_indices: [0] },
      decision: { text: "", rationale: "", supporting_item_indices: [1] },
      alternative_options: [
        { text: "x", rationale: "", supporting_item_indices: [0, 1] },
      ],
    });
    expect(result.context.supporting_item_indices).toEqual([0]);
  });

  test("rejects indices outside referenced_items range with a clear path", () => {
    const out = DecisionSchema.safeParse({
      title: "t",
      status: "accepted",
      referenced_items: [ideaUnitRef],
      context: { text: "", supporting_item_indices: [5] },
      decision: { text: "", rationale: "", supporting_item_indices: [] },
      alternative_options: [],
    });
    expect(out.success).toBe(false);
    if (!out.success) {
      const issue = out.error.issues[0];
      expect(issue.path).toEqual(["context", "supporting_item_indices", 0]);
      expect(issue.message).toContain("out of range");
    }
  });

  test("rejects out-of-range indices in alternative_options", () => {
    const out = DecisionSchema.safeParse({
      title: "t",
      status: "accepted",
      referenced_items: [ideaUnitRef],
      context: { text: "", supporting_item_indices: [] },
      decision: { text: "", rationale: "", supporting_item_indices: [] },
      alternative_options: [
        { text: "x", rationale: "", supporting_item_indices: [0, 2] },
      ],
    });
    expect(out.success).toBe(false);
    if (!out.success) {
      const offending = out.error.issues.find((i) =>
        i.path.includes("alternative_options"),
      );
      expect(offending).toBeDefined();
      expect(offending!.path).toEqual([
        "alternative_options",
        0,
        "supporting_item_indices",
        1,
      ]);
    }
  });
});
