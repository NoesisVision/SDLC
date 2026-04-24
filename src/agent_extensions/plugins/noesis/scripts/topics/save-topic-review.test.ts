import { describe, expect, test } from "bun:test";
import { saveTopicReview } from "./save-topic-review.js";
import type { TopicReviewResult } from "./save-topic-review.js";
import { replacePlaceholderIds } from "./topic-helpers.js";
import type { Conversation } from "../../shared-contracts/conversation.js";

function makeConversation(): Conversation {
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
          { index: 0, sentences: ["Point A."], categories: ["Information"] },
          { index: 1, sentences: ["Point B."], categories: ["Position"] },
        ],
      },
    ],
    topics: [
      {
        id: "topic-1",
        title: "Architecture",
        short_summary: "Old summary",
        long_summary: "Old long summary",
        items: [
          { type: "idea_unit_ref", conversation_id: "conv-1", turn_index: 0, idea_unit_index: 0 },
          { type: "idea_unit_ref", conversation_id: "conv-1", turn_index: 0, idea_unit_index: 1 },
        ],
        decisions: [],
        reviewed: false,
        decisions_extracted: false,
      },
    ],
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("replacePlaceholderIds", () => {
  test("replaces placeholder IDs with real UUIDs and updates reassignments", () => {
    const review: TopicReviewResult = {
      topic_id: "topic-1",
      short_summary: "",
      long_summary: "",
      reassignments: [
        { turn_index: 0, idea_unit_index: 1, new_topic_id: "new-1" },
      ],
      new_topics: [
        { id: "new-1", title: "New", short_summary: "", path: [], is_new: true, parent_id: null },
      ],
    };

    replacePlaceholderIds(review.new_topics, (oldId, newId) => {
      for (const r of review.reassignments) {
        if (r.new_topic_id === oldId) r.new_topic_id = newId;
      }
    });

    expect(review.new_topics[0].id).toMatch(UUID_PATTERN);
    expect(review.reassignments[0].new_topic_id).toBe(review.new_topics[0].id);
  });

  test("updates parent_id cross-references among new topics", () => {
    const review: TopicReviewResult = {
      topic_id: "topic-1",
      short_summary: "",
      long_summary: "",
      reassignments: [],
      new_topics: [
        { id: "new-1", title: "Parent", short_summary: "", path: [], is_new: true, parent_id: null },
        { id: "new-2", title: "Child", short_summary: "", path: [], is_new: true, parent_id: "new-1" },
      ],
    };

    replacePlaceholderIds(review.new_topics, () => {});

    expect(review.new_topics[1].parent_id).toBe(review.new_topics[0].id);
    expect(review.new_topics[0].id).toMatch(UUID_PATTERN);
    expect(review.new_topics[1].id).toMatch(UUID_PATTERN);
  });
});

describe("saveTopicReview", () => {
  test("updates summaries and marks as reviewed", () => {
    const conv = makeConversation();
    const review: TopicReviewResult = {
      topic_id: "topic-1",
      short_summary: "New summary",
      long_summary: "New long summary",
      reassignments: [],
      new_topics: [],
    };

    saveTopicReview(conv, review);

    expect(conv.topics[0].short_summary).toBe("New summary");
    expect(conv.topics[0].long_summary).toBe("New long summary");
    expect(conv.topics[0].reviewed).toBe(true);
  });

  test("reassigns idea units to existing topic", () => {
    const conv = makeConversation();
    conv.topics.push({
      id: "topic-2",
      title: "Performance",
      short_summary: "",
      long_summary: "",
      items: [],
      decisions: [],
      reviewed: false,
      decisions_extracted: false,
    });

    const review: TopicReviewResult = {
      topic_id: "topic-1",
      short_summary: "Updated",
      long_summary: "Updated long",
      reassignments: [
        { turn_index: 0, idea_unit_index: 1, new_topic_id: "topic-2" },
      ],
      new_topics: [],
    };

    saveTopicReview(conv, review);

    expect(conv.topics[0].items).toHaveLength(1);
    const topic1Item = conv.topics[0].items[0];
    expect(topic1Item.type).toBe("idea_unit_ref");
    if (topic1Item.type === "idea_unit_ref") {
      expect(topic1Item.idea_unit_index).toBe(0);
    }
    expect(conv.topics[1].items).toHaveLength(1);
    const topic2Item = conv.topics[1].items[0];
    expect(topic2Item.type).toBe("idea_unit_ref");
    if (topic2Item.type === "idea_unit_ref") {
      expect(topic2Item.idea_unit_index).toBe(1);
    }
  });

  test("creates new topic for reassignment when target not found", () => {
    const conv = makeConversation();
    const review: TopicReviewResult = {
      topic_id: "topic-1",
      short_summary: "Updated",
      long_summary: "Updated long",
      reassignments: [
        { turn_index: 0, idea_unit_index: 1, new_topic_id: "new-topic" },
      ],
      new_topics: [
        {
          id: "new-topic",
          title: "New Topic",
          short_summary: "New summary",
          path: ["New Topic"],
          is_new: true,
          parent_id: null,
        },
      ],
    };

    saveTopicReview(conv, review);

    expect(conv.topics).toHaveLength(2);
    expect(conv.topics[1].id).toBe("new-topic");
    expect(conv.topics[1].title).toBe("New Topic");
    expect(conv.topics[1].items).toHaveLength(1);
  });
});
