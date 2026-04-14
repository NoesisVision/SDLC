import { describe, expect, test } from "bun:test";
import { loadTopicForReview } from "./load-topic-for-review.js";
import type { Conversation } from "../conversation/types.js";
import type { KnowledgeGraph } from "../knowledge-graph/types.js";

function makeConversation(reviewed: boolean = false): Conversation {
  return {
    conversation_id: "conv-1",
    time: "2026-01-15 10:00:00",
    main_topic: "Test",
    turns: [
      {
        index: 0,
        speaker: "Alice",
        time: "00:01:00",
        idea_units: [
          { index: 0, sentences: ["First point."], categories: ["Information"] },
          { index: 1, sentences: ["Second point."], categories: ["Position"] },
        ],
      },
    ],
    topics: [
      {
        id: "topic-1",
        title: "Architecture",
        short_summary: "Arch summary",
        long_summary: "Long arch summary",
        idea_units: [
          { conversation_id: "conv-1", turn_index: 0, idea_unit_index: 0 },
        ],
        subtopics: [],
        reviewed,
        decisions_extracted: false,
      },
    ],
    decisions: [],
  };
}

const emptyKg: KnowledgeGraph = { conversations: [], topics: [], decisions: [] };

describe("loadTopicForReview", () => {
  test("returns null when all topics are reviewed", () => {
    const conv = makeConversation(true);
    const result = loadTopicForReview(conv, emptyKg);
    expect(result).toBeNull();
  });

  test("returns enriched topic with idea unit details", () => {
    const conv = makeConversation(false);
    const result = loadTopicForReview(conv, emptyKg);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("topic-1");
    expect(result!.title).toBe("Architecture");
    expect(result!.conversation_id).toBe("conv-1");
    expect(result!.idea_units).toHaveLength(1);
    expect(result!.idea_units[0].speaker).toBe("Alice");
    expect(result!.idea_units[0].sentences).toEqual(["First point."]);
  });

  test("includes idea units from knowledge graph topic", () => {
    const conv = makeConversation(false);
    const kg: KnowledgeGraph = {
      conversations: [
        {
          conversation_id: "conv-old",
          time: "2025-12-01 10:00:00",
          main_topic: "Old meeting",
          turns: [
            {
              index: 0,
              speaker: "Bob",
              time: "00:05:00",
              idea_units: [
                { index: 0, sentences: ["Old point."], categories: ["Argument"] },
              ],
            },
          ],
        },
      ],
      topics: [
        {
          id: "topic-1",
          title: "Architecture",
          short_summary: "",
          long_summary: "",
          idea_units: [
            { conversation_id: "conv-old", turn_index: 0, idea_unit_index: 0 },
          ],
          subtopics: [],
          reviewed: true,
          decisions_extracted: true,
        },
      ],
      decisions: [],
    };

    const result = loadTopicForReview(conv, kg);
    expect(result!.idea_units).toHaveLength(2);
    expect(result!.idea_units[1].speaker).toBe("Bob");
  });

  test("deduplicates refs across conversation and KG", () => {
    const conv = makeConversation(false);
    const kg: KnowledgeGraph = {
      conversations: [],
      topics: [
        {
          id: "topic-1",
          title: "Architecture",
          short_summary: "",
          long_summary: "",
          idea_units: [
            { conversation_id: "conv-1", turn_index: 0, idea_unit_index: 0 },
          ],
          subtopics: [],
          reviewed: true,
          decisions_extracted: true,
        },
      ],
      decisions: [],
    };

    const result = loadTopicForReview(conv, kg);
    expect(result!.idea_units).toHaveLength(1);
  });

  test("filters out purely Irrelevant idea units", () => {
    const conv = makeConversation(false);
    conv.turns[0].idea_units.push(
      { index: 2, sentences: ["Filler."], categories: ["Irrelevant"] },
    );
    conv.topics[0].idea_units.push(
      { conversation_id: "conv-1", turn_index: 0, idea_unit_index: 2 },
    );

    const result = loadTopicForReview(conv, emptyKg);
    expect(result!.idea_units).toHaveLength(1);
    expect(result!.idea_units[0].sentences).toEqual(["First point."]);
  });

  test("keeps multi-category idea units that include Irrelevant", () => {
    const conv = makeConversation(false);
    conv.turns[0].idea_units[0].categories = ["Irrelevant", "Information"];

    const result = loadTopicForReview(conv, emptyKg);
    expect(result!.idea_units).toHaveLength(1);
  });

  test("skips refs with missing turns", () => {
    const conv = makeConversation(false);
    conv.topics[0].idea_units.push({
      conversation_id: "conv-1",
      turn_index: 99,
      idea_unit_index: 0,
    });

    const result = loadTopicForReview(conv, emptyKg);
    expect(result!.idea_units).toHaveLength(1);
  });
});
