import { describe, expect, test } from "bun:test";
import { loadTopicForDecisions } from "./load-topic-for-decisions.js";
import type { Conversation } from "../../shared-contracts/conversation.js";

function makeConversation(decisionsExtracted: boolean = false): Conversation {
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
          { index: 0, sentences: ["Important point."], categories: ["Decision"] },
          { index: 1, sentences: ["Filler."], categories: ["Irrelevant"] },
          { index: 2, sentences: ["Another point."], categories: ["Information", "Decision"] },
        ],
      },
    ],
    topics: [
      {
        id: "topic-1",
        title: "Architecture",
        short_summary: "Summary",
        long_summary: "Long summary",
        items: [
          { type: "conversation_idea_unit", conversation_id: "conv-1", turn_index: 0, idea_unit_index: 0 },
          { type: "conversation_idea_unit", conversation_id: "conv-1", turn_index: 0, idea_unit_index: 1 },
          { type: "conversation_idea_unit", conversation_id: "conv-1", turn_index: 0, idea_unit_index: 2 },
        ],
        decisions: [],
        reviewed: true,
        decisions_extracted: decisionsExtracted,
      },
    ],
  };
}

describe("loadTopicForDecisions", () => {
  test("returns null when all topics have decisions extracted", () => {
    const conv = makeConversation(true);
    const result = loadTopicForDecisions(conv, null);
    expect(result).toBeNull();
  });

  test("returns enriched topic filtering out Irrelevant idea units", () => {
    const conv = makeConversation(false);
    const result = loadTopicForDecisions(conv, null);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("topic-1");
    expect(result!.idea_units).toHaveLength(2);
    expect(result!.idea_units[0].sentences).toEqual(["Important point."]);
    expect(result!.idea_units[1].sentences).toEqual(["Another point."]);
  });

  test("loads specific topic by ID", () => {
    const conv = makeConversation(false);
    const result = loadTopicForDecisions(conv, "topic-1");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("topic-1");
  });

  test("returns null for unknown topic ID", () => {
    const conv = makeConversation(false);
    const result = loadTopicForDecisions(conv, "unknown");
    expect(result).toBeNull();
  });

  test("skips refs from other conversations", () => {
    const conv = makeConversation(false);
    conv.topics[0].items.push({
      type: "conversation_idea_unit",
      conversation_id: "other-conv",
      turn_index: 0,
      idea_unit_index: 0,
    });
    const result = loadTopicForDecisions(conv, null);
    expect(result!.idea_units).toHaveLength(2);
  });

  test("keeps idea units with multiple categories including Irrelevant", () => {
    const conv = makeConversation(false);
    conv.turns[0].idea_units[1].categories = ["Irrelevant", "Information"];
    const result = loadTopicForDecisions(conv, null);
    expect(result!.idea_units).toHaveLength(3);
  });

  test("ignores document_fragment items", () => {
    const conv = makeConversation(false);
    conv.topics[0].items.push({
      type: "document_fragment",
      document_id: "doc-1",
      start_offset: 10,
      end_offset: 50,
    });
    const result = loadTopicForDecisions(conv, null);
    expect(result!.idea_units).toHaveLength(2);
  });
});
