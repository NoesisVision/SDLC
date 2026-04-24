import { describe, expect, test } from "bun:test";
import { saveTopicDecisions, type DecisionExtractionResult } from "./save-topic-decisions.js";
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
        title: "T1",
        short_summary: "",
        long_summary: "",
        items: [],
        decisions: [],
        reviewed: true,
        decisions_extracted: false,
      },
    ],
    decision_attachments: [],
    design_doc_id: null,
    design_doc_title: null,
    design_doc_extracted: false,
  };
}

describe("saveTopicDecisions", () => {
  test("appends decisions and marks topic decisions_extracted", () => {
    const analysis = makeAnalysis();
    const result: DecisionExtractionResult = {
      topic_id: "topic-1",
      decisions: [
        {
          id: "d1",
          title: "Use Postgres",
          status: "accepted",
          context: { text: "Pick a DB", supporting_items: [] },
          decision: { text: "Postgres", rationale: "ACID", supporting_items: [] },
          alternative_options: [],
        },
      ],
      attachments: [],
    };
    saveTopicDecisions(analysis, result);
    expect(analysis.topics[0].decisions).toHaveLength(1);
    expect(analysis.topics[0].decisions_extracted).toBe(true);
  });

  test("records attachments with valid fragment indices", () => {
    const analysis = makeAnalysis();
    const result: DecisionExtractionResult = {
      topic_id: "topic-1",
      decisions: [],
      attachments: [
        {
          decision_id: "existing-1",
          slot: "context",
          alternative_index: null,
          fragment_indices: [0, 1],
        },
      ],
    };
    saveTopicDecisions(analysis, result);
    expect(analysis.decision_attachments).toHaveLength(1);
    expect(analysis.decision_attachments[0].fragment_indices).toEqual([0, 1]);
  });

  test("rejects attachment with slot=alternative and missing alternative_index", () => {
    const analysis = makeAnalysis();
    const result: DecisionExtractionResult = {
      topic_id: "topic-1",
      decisions: [],
      attachments: [
        {
          decision_id: "existing-1",
          slot: "alternative",
          alternative_index: null,
          fragment_indices: [0],
        },
      ],
    };
    expect(() => saveTopicDecisions(analysis, result)).toThrow(
      /alternative_index/,
    );
  });

  test("rejects attachment referencing unknown fragment", () => {
    const analysis = makeAnalysis();
    const result: DecisionExtractionResult = {
      topic_id: "topic-1",
      decisions: [],
      attachments: [
        {
          decision_id: "existing-1",
          slot: "context",
          alternative_index: null,
          fragment_indices: [99],
        },
      ],
    };
    expect(() => saveTopicDecisions(analysis, result)).toThrow(
      /Fragment not found/,
    );
  });
});
