import { describe, expect, test } from "bun:test";
import { saveChunkResult } from "./save-chunk-result.js";
import type { Conversation, ChunkResult } from "../conversation/types.js";
import { appendNewTopics, replacePlaceholderIds } from "./types.js";
import type { PotentialTopic } from "./types.js";

function makeConversation(): Conversation {
  return {
    conversation_id: "conv-1",
    time: "2026-01-15 10:00:00",
    main_topic: "Test",
    turns: [],
    topics: [],
    decisions: [],
  };
}

function makeChunkResult(): ChunkResult {
  return {
    turns: [
      {
        index: 0,
        speaker: "Alice",
        time: "00:01:00",
        idea_units: [
          { index: 0, sentences: ["Hello."], categories: ["Information"] },
        ],
      },
    ],
    assignments: [
      { turn_index: 0, idea_unit_index: 0, topic_id: "topic-1" },
    ],
    new_topics: [
      {
        id: "topic-1",
        title: "Greetings",
        short_summary: "Hello topic",
        path: ["Greetings"],
        is_new: true,
        parent_id: null,
      },
    ],
  };
}

describe("saveChunkResult", () => {
  test("appends turns to conversation", () => {
    const conv = makeConversation();
    const chunk = makeChunkResult();
    saveChunkResult(conv, chunk);
    expect(conv.turns).toHaveLength(1);
    expect(conv.turns[0].speaker).toBe("Alice");
  });

  test("creates topic from new_topics and assigns idea unit ref", () => {
    const conv = makeConversation();
    const chunk = makeChunkResult();
    saveChunkResult(conv, chunk);

    expect(conv.topics).toHaveLength(1);
    expect(conv.topics[0].id).toBe("topic-1");
    expect(conv.topics[0].title).toBe("Greetings");
    expect(conv.topics[0].idea_units).toHaveLength(1);
    expect(conv.topics[0].idea_units[0]).toEqual({
      conversation_id: "conv-1",
      turn_index: 0,
      idea_unit_index: 0,
    });
  });

  test("appends to existing topic", () => {
    const conv = makeConversation();
    conv.topics = [
      {
        id: "topic-1",
        title: "Existing",
        short_summary: "",
        long_summary: "",
        idea_units: [],
        subtopics: [],
        reviewed: false,
        decisions_extracted: false,
      },
    ];
    const chunk = makeChunkResult();
    saveChunkResult(conv, chunk);

    expect(conv.topics).toHaveLength(1);
    expect(conv.topics[0].title).toBe("Existing");
    expect(conv.topics[0].idea_units).toHaveLength(1);
  });

  test("creates fallback topic when ID not in new_topics", () => {
    const conv = makeConversation();
    const chunk = makeChunkResult();
    chunk.new_topics = [];
    saveChunkResult(conv, chunk);

    expect(conv.topics).toHaveLength(1);
    expect(conv.topics[0].title).toBe("");
  });
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("replacePlaceholderIds", () => {
  test("replaces placeholder IDs with real UUIDs for is_new topics", () => {
    const chunk = makeChunkResult();
    chunk.new_topics[0].id = "new-1";
    chunk.assignments[0].topic_id = "new-1";

    replacePlaceholderIds(chunk.new_topics, (oldId, newId) => {
      for (const a of chunk.assignments) {
        if (a.topic_id === oldId) a.topic_id = newId;
      }
    });

    expect(chunk.new_topics[0].id).not.toBe("new-1");
    expect(chunk.new_topics[0].id).toMatch(UUID_PATTERN);
    expect(chunk.assignments[0].topic_id).toBe(chunk.new_topics[0].id);
  });

  test("does not replace IDs for non-new topics", () => {
    const chunk = makeChunkResult();
    chunk.new_topics[0].is_new = false;
    const originalId = chunk.new_topics[0].id;

    replacePlaceholderIds(chunk.new_topics, () => {});

    expect(chunk.new_topics[0].id).toBe(originalId);
  });

  test("updates parent_id cross-references among new topics", () => {
    const chunk = makeChunkResult();
    chunk.new_topics = [
      { id: "new-1", title: "Parent", short_summary: "", path: [], is_new: true, parent_id: null },
      { id: "new-2", title: "Child", short_summary: "", path: [], is_new: true, parent_id: "new-1" },
    ];
    chunk.assignments = [
      { turn_index: 0, idea_unit_index: 0, topic_id: "new-1" },
      { turn_index: 0, idea_unit_index: 1, topic_id: "new-2" },
    ];

    replacePlaceholderIds(chunk.new_topics, (oldId, newId) => {
      for (const a of chunk.assignments) {
        if (a.topic_id === oldId) a.topic_id = newId;
      }
    });

    const parentId = chunk.new_topics[0].id;
    const childId = chunk.new_topics[1].id;
    expect(parentId).toMatch(UUID_PATTERN);
    expect(childId).toMatch(UUID_PATTERN);
    expect(chunk.new_topics[1].parent_id).toBe(parentId);
    expect(chunk.assignments[0].topic_id).toBe(parentId);
    expect(chunk.assignments[1].topic_id).toBe(childId);
  });

  test("leaves assignments for existing topics unchanged", () => {
    const chunk = makeChunkResult();
    chunk.assignments.push({ turn_index: 1, idea_unit_index: 0, topic_id: "existing-topic" });
    chunk.new_topics[0].id = "new-1";
    chunk.assignments[0].topic_id = "new-1";

    replacePlaceholderIds(chunk.new_topics, (oldId, newId) => {
      for (const a of chunk.assignments) {
        if (a.topic_id === oldId) a.topic_id = newId;
      }
    });

    expect(chunk.assignments[1].topic_id).toBe("existing-topic");
  });
});

describe("appendNewTopics", () => {
  test("merges new topics without duplicates", () => {
    const existing: PotentialTopic[] = [
      { id: "a", title: "A", short_summary: "", path: [], is_new: false, parent_id: null },
    ];
    const newTopics: PotentialTopic[] = [
      { id: "a", title: "A dup", short_summary: "", path: [], is_new: true, parent_id: null },
      { id: "b", title: "B", short_summary: "", path: [], is_new: true, parent_id: null },
    ];
    const result = appendNewTopics(existing, newTopics);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("A");
    expect(result[1].title).toBe("B");
  });
});
