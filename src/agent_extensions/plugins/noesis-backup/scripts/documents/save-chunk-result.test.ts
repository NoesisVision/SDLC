import { describe, expect, test } from "bun:test";
import { saveChunkResult, type ChunkResult } from "./save-chunk-result.js";
import type { DocumentAnalysis, DocumentFragment } from "../../shared-contracts/document-analysis.js";
import { replacePlaceholderIds } from "../topics/topic-helpers.js";

function fragment(index: number, start: number, end: number): DocumentFragment {
  return {
    index,
    start_offset: start,
    end_offset: end,
    section_path: ["S"],
    kind: "paragraph",
    text: `frag-${index}`,
    categories: [],
  };
}

function makeAnalysis(): DocumentAnalysis {
  return {
    document_id: "doc-1",
    document_title: "T",
    document_date: "2026-04-24",
    fragments: [fragment(0, 0, 10), fragment(1, 11, 20), fragment(2, 21, 30)],
    section_tree: [],
    topics: [],
    decision_attachments: [],
    design_doc_id: null,
    design_doc_title: null,
    design_doc_extracted: false,
  };
}

describe("saveChunkResult", () => {
  test("applies categories to fragments", () => {
    const analysis = makeAnalysis();
    const chunk: ChunkResult = {
      fragment_categories: [
        { fragment_index: 0, categories: ["Information"] },
        { fragment_index: 2, categories: ["Decision"] },
      ],
      assignments: [],
      new_topics: [],
    };
    saveChunkResult(analysis, chunk);
    expect(analysis.fragments[0].categories).toEqual(["Information"]);
    expect(analysis.fragments[1].categories).toEqual([]);
    expect(analysis.fragments[2].categories).toEqual(["Decision"]);
  });

  test("creates topic from new_topics and attaches document fragment ref", () => {
    const analysis = makeAnalysis();
    const chunk: ChunkResult = {
      fragment_categories: [],
      assignments: [{ fragment_index: 0, topic_id: "topic-1" }],
      new_topics: [
        {
          id: "topic-1",
          title: "T1",
          short_summary: "x",
          path: ["T1"],
          is_new: true,
          parent_id: null,
        },
      ],
    };
    saveChunkResult(analysis, chunk);
    expect(analysis.topics).toHaveLength(1);
    const item = analysis.topics[0].items[0];
    expect(item).toEqual({
      type: "document_fragment_ref",
      document_id: "doc-1",
      start_offset: 0,
      end_offset: 10,
    });
  });

  test("appends fragment to existing topic without duplicating", () => {
    const analysis = makeAnalysis();
    analysis.topics.push({
      id: "topic-1",
      title: "Existing",
      short_summary: "",
      long_summary: "",
      items: [],
      decisions: [],
      reviewed: false,
      decisions_extracted: false,
    });
    const chunk: ChunkResult = {
      fragment_categories: [],
      assignments: [{ fragment_index: 1, topic_id: "topic-1" }],
      new_topics: [],
    };
    saveChunkResult(analysis, chunk);
    expect(analysis.topics).toHaveLength(1);
    expect(analysis.topics[0].items).toHaveLength(1);
  });

  test("placeholder ids are replaced and assignments updated", () => {
    const chunk: ChunkResult = {
      fragment_categories: [],
      assignments: [{ fragment_index: 0, topic_id: "new-1" }],
      new_topics: [
        {
          id: "new-1",
          title: "Fresh",
          short_summary: "",
          path: ["Fresh"],
          is_new: true,
          parent_id: null,
        },
      ],
    };
    replacePlaceholderIds(chunk.new_topics, (oldId, newId) => {
      for (const a of chunk.assignments) {
        if (a.topic_id === oldId) a.topic_id = newId;
      }
    });
    expect(chunk.new_topics[0].id).not.toBe("new-1");
    expect(chunk.assignments[0].topic_id).toBe(chunk.new_topics[0].id);
  });
});
