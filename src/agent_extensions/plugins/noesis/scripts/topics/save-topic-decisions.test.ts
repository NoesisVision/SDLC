import { describe, expect, test } from "bun:test";
import { saveTopicDecisions } from "./save-topic-decisions.js";
import type { Conversation } from "../conversation/types.js";
import type { DecisionExtractionResult } from "./types.js";

function makeConversation(): Conversation {
  return {
    conversation_id: "conv-1",
    time: "2026-01-15 10:00:00",
    main_topic: "Test",
    turns: [],
    topics: [
      {
        id: "topic-1",
        title: "Architecture",
        short_summary: "Summary",
        long_summary: "Long summary",
        idea_units: [],
        subtopics: [],
        reviewed: true,
        decisions_extracted: false,
      },
    ],
    decisions: [],
  };
}

describe("saveTopicDecisions", () => {
  test("appends decisions and marks topic as extracted", () => {
    const conv = makeConversation();
    const result: DecisionExtractionResult = {
      topic_id: "topic-1",
      decisions: [
        {
          title: "Use microservices",
          status: "accepted",
          context: {
            text: "Architecture discussion",
            supporting_idea_units: [],
          },
          decision: {
            text: "Go with microservices",
            rationale: "Better scalability",
            supporting_idea_units: [],
          },
          alternative_options: [],
        },
      ],
    };

    saveTopicDecisions(conv, result);

    expect(conv.decisions).toHaveLength(1);
    expect(conv.decisions[0].title).toBe("Use microservices");
    expect(conv.topics[0].decisions_extracted).toBe(true);
  });

  test("appends multiple decisions", () => {
    const conv = makeConversation();
    const result: DecisionExtractionResult = {
      topic_id: "topic-1",
      decisions: [
        {
          title: "Decision 1",
          status: "accepted",
          context: { text: "", supporting_idea_units: [] },
          decision: { text: "", rationale: "", supporting_idea_units: [] },
          alternative_options: [],
        },
        {
          title: "Decision 2",
          status: "proposed",
          context: { text: "", supporting_idea_units: [] },
          decision: { text: "", rationale: "", supporting_idea_units: [] },
          alternative_options: [],
        },
      ],
    };

    saveTopicDecisions(conv, result);
    expect(conv.decisions).toHaveLength(2);
  });

  test("preserves existing decisions", () => {
    const conv = makeConversation();
    conv.decisions = [
      {
        title: "Existing",
        status: "accepted",
        context: { text: "", supporting_idea_units: [] },
        decision: { text: "", rationale: "", supporting_idea_units: [] },
        alternative_options: [],
      },
    ];

    const result: DecisionExtractionResult = {
      topic_id: "topic-1",
      decisions: [
        {
          title: "New",
          status: "accepted",
          context: { text: "", supporting_idea_units: [] },
          decision: { text: "", rationale: "", supporting_idea_units: [] },
          alternative_options: [],
        },
      ],
    };

    saveTopicDecisions(conv, result);
    expect(conv.decisions).toHaveLength(2);
    expect(conv.decisions[0].title).toBe("Existing");
    expect(conv.decisions[1].title).toBe("New");
  });
});
