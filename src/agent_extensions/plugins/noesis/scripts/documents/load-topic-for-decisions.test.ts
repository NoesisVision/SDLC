import { describe, expect, test } from "bun:test";
import { loadTopicForDecisions } from "./load-topic-for-decisions.js";
import type { DocumentAnalysis } from "../../shared-contracts/document-analysis.js";

function makeAnalysis(): DocumentAnalysis {
  return {
    document_id: "doc-1",
    document_title: "T",
    document_date: "2026-04-24",
    fragments: [
      { index: 0, start_offset: 0, end_offset: 10, section_path: ["S"], kind: "paragraph", text: "alpha", categories: ["Information"] },
      { index: 1, start_offset: 11, end_offset: 20, section_path: ["S"], kind: "paragraph", text: "beta", categories: ["Decision"] },
    ],
    section_tree: [],
    topics: [
      {
        id: "t1",
        title: "Topic 1",
        short_summary: "s",
        long_summary: "l",
        items: [
          { type: "document_fragment_ref", document_id: "doc-1", start_offset: 0, end_offset: 10 },
          { type: "document_fragment_ref", document_id: "doc-1", start_offset: 11, end_offset: 20 },
        ],
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

describe("loadTopicForDecisions", () => {
  test("returns first topic without decisions extracted", () => {
    const analysis = makeAnalysis();
    const enriched = loadTopicForDecisions(analysis, null);
    expect(enriched).not.toBeNull();
    expect(enriched!.id).toBe("t1");
    expect(enriched!.fragments).toHaveLength(2);
    expect(enriched!.fragments[0].text).toBe("alpha");
    expect(enriched!.fragments[1].categories).toContain("Decision");
  });

  test("returns specific topic when topic_id passed", () => {
    const analysis = makeAnalysis();
    const enriched = loadTopicForDecisions(analysis, "t1");
    expect(enriched).not.toBeNull();
    expect(enriched!.id).toBe("t1");
  });

  test("returns null when no unprocessed topic", () => {
    const analysis = makeAnalysis();
    analysis.topics[0].decisions_extracted = true;
    expect(loadTopicForDecisions(analysis, null)).toBeNull();
  });

  test("excludes irrelevant fragments", () => {
    const analysis = makeAnalysis();
    analysis.fragments[0].categories = ["Irrelevant"];
    const enriched = loadTopicForDecisions(analysis, "t1");
    expect(enriched!.fragments).toHaveLength(1);
    expect(enriched!.fragments[0].text).toBe("beta");
  });
});
