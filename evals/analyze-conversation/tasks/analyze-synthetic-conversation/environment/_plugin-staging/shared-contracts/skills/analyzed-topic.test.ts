import { describe, expect, test } from "bun:test";
import { AnalyzedTopicSchema, AnalyzedDecisionSchema } from "./analyzed-topic.js";

describe("AnalyzedDecision", () => {
  const ideaUnitRef = {
    type: "idea_unit_ref" as const,
    conversation_id: "c1",
    turn_index: 0,
    idea_unit_index: 0,
  };

  test("fills id with a uuid when omitted", () => {
    const result = AnalyzedDecisionSchema.parse({
      title: "t",
      status: "accepted",
      context: { text: "", supporting_content: [] },
      decision: { text: "", rationale: "", supporting_content: [] },
      alternative_options: [],
    });
    expect(result.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test("accepts supporting_content references attached to every slot", () => {
    const result = AnalyzedDecisionSchema.parse({
      title: "t",
      status: "accepted",
      context: { text: "", supporting_content: [ideaUnitRef] },
      decision: {
        text: "",
        rationale: "",
        supporting_content: [ideaUnitRef],
      },
      alternative_options: [
        { text: "x", rationale: "", supporting_content: [ideaUnitRef] },
      ],
    });
    expect(result.context.supporting_content).toEqual([ideaUnitRef]);
    expect(result.decision.supporting_content).toEqual([ideaUnitRef]);
    expect(result.alternative_options[0].supporting_content).toEqual([
      ideaUnitRef,
    ]);
  });
});

describe("AnalyzedTopicSchema", () => {
  test("defaults parent_id to null and is_new to false", () => {
    const result = AnalyzedTopicSchema.parse({
      id: "t-1",
      title: "Topic",
      short_summary: "s",
      long_summary: "l",
      items: [],
    });
    expect(result.parent_id).toBeNull();
    expect(result.is_new).toBe(false);
    expect(result.decisions).toEqual([]);
    expect(result.reviewed).toBe(false);
    expect(result.decisions_extracted).toBe(false);
  });

  test("accepts an explicit parent_id and is_new", () => {
    const result = AnalyzedTopicSchema.parse({
      id: "t-2",
      parent_id: "t-1",
      is_new: true,
      title: "Child",
      short_summary: "s",
      long_summary: "l",
      items: [],
    });
    expect(result.parent_id).toBe("t-1");
    expect(result.is_new).toBe(true);
  });
});
