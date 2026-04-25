import { describe, expect, test } from "bun:test";
import { saveTopicReview, type TopicReviewResult } from "./save-topic-review.js";
import type { DocumentAnalysis } from "../../shared-contracts/document-analysis.js";

function makeAnalysis(): DocumentAnalysis {
  return {
    document_id: "doc-1",
    document_title: "T",
    document_date: "2026-04-24",
    fragments: [
      { index: 0, start_offset: 0, end_offset: 10, section_path: [], kind: "paragraph", text: "a", categories: [] },
      { index: 1, start_offset: 11, end_offset: 20, section_path: [], kind: "paragraph", text: "b", categories: [] },
    ],
    section_tree: [],
    topics: [
      {
        id: "topic-1",
        title: "Architecture",
        short_summary: "old",
        long_summary: "old long",
        items: [
          { type: "document_fragment_ref", document_id: "doc-1", start_offset: 0, end_offset: 10 },
          { type: "document_fragment_ref", document_id: "doc-1", start_offset: 11, end_offset: 20 },
        ],
        decisions: [],
        reviewed: false,
        decisions_extracted: false,
      },
    ],
    decision_attachments: [],
    design_doc_id: null,
    design_doc_title: null,
    design_doc_extracted: false,
  };
}

describe("saveTopicReview", () => {
  test("updates summaries and marks topic reviewed", () => {
    const analysis = makeAnalysis();
    const review: TopicReviewResult = {
      topic_id: "topic-1",
      short_summary: "new",
      long_summary: "new long",
      reassignments: [],
      new_topics: [],
    };
    saveTopicReview(analysis, review);
    expect(analysis.topics[0].short_summary).toBe("new");
    expect(analysis.topics[0].long_summary).toBe("new long");
    expect(analysis.topics[0].reviewed).toBe(true);
  });

  test("reassigns a fragment from one topic to another", () => {
    const analysis = makeAnalysis();
    analysis.topics.push({
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
      short_summary: "x",
      long_summary: "y",
      reassignments: [{ fragment_index: 1, new_topic_id: "topic-2" }],
      new_topics: [],
    };

    saveTopicReview(analysis, review);
    expect(analysis.topics[0].items).toHaveLength(1);
    expect(analysis.topics[1].items).toHaveLength(1);
    const moved = analysis.topics[1].items[0];
    expect(moved.type).toBe("document_fragment_ref");
    if (moved.type === "document_fragment_ref") {
      expect(moved.start_offset).toBe(11);
      expect(moved.end_offset).toBe(20);
    }
  });

  test("creates new topic for reassignment when target missing", () => {
    const analysis = makeAnalysis();
    const review: TopicReviewResult = {
      topic_id: "topic-1",
      short_summary: "x",
      long_summary: "y",
      reassignments: [{ fragment_index: 1, new_topic_id: "fresh" }],
      new_topics: [
        {
          id: "fresh",
          title: "Fresh",
          short_summary: "",
          path: ["Fresh"],
          is_new: true,
          parent_id: null,
        },
      ],
    };
    saveTopicReview(analysis, review);
    expect(analysis.topics).toHaveLength(2);
    expect(analysis.topics[1].id).toBe("fresh");
    expect(analysis.topics[1].items).toHaveLength(1);
  });
});
