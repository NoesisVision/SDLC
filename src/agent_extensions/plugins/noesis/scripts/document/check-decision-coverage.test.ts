import { describe, expect, test } from "bun:test";
import {
  checkDecisionCoverage,
  formatCheckResult,
} from "./check-decision-coverage.js";
import type { AnalyzeDesignDraftOutput } from "../../shared-contracts/skills/analyze-design-draft/output.js";

function fragment(
  index: number,
  section: string[],
  categories: string[],
): AnalyzeDesignDraftOutput["fragments"][number] {
  return {
    index,
    start_offset: index * 10,
    end_offset: index * 10 + 5,
    section_path: section,
    kind: "paragraph",
    text: `Fragment ${index}`,
    categories: categories as AnalyzeDesignDraftOutput["fragments"][number]["categories"],
  };
}

function buildOutput(
  fragments: AnalyzeDesignDraftOutput["fragments"],
): AnalyzeDesignDraftOutput {
  return {
    document: {
      id: "doc-1",
      title: "T",
      date: "2026-04-28",
      content: "",
    },
    fragments,
    section_tree: [],
    topics: [],
    decision_attachments: [],
    potential_topics: { topics: [] },
    design_doc_id: null,
    design_doc_title: null,
    design_doc_extracted: false,
  };
}

describe("checkDecisionCoverage", () => {
  test("warns when a `Reguły biznesowe` section has 0 Decision categorisations", () => {
    const fragments = [
      fragment(0, ["Reguły biznesowe", "Polityka wyceny"], ["Position"]),
      fragment(1, ["Reguły biznesowe", "Polityka wyceny"], ["Position"]),
      fragment(2, ["Reguły biznesowe", "Polityka wyceny"], ["Information"]),
      fragment(3, ["Reguły biznesowe", "Polityka wyceny"], ["Information"]),
    ];
    const result = checkDecisionCoverage(buildOutput(fragments));
    expect(result.status).toBe("Warning");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].section).toContain("Reguły biznesowe");
    expect(result.warnings[0].decisions).toBe(0);
    expect(result.warnings[0].total).toBe(4);
  });

  test("Ok when ≥30% of fragments in the section are Decision", () => {
    const fragments = [
      fragment(0, ["Decisions"], ["Decision"]),
      fragment(1, ["Decisions"], ["Decision"]),
      fragment(2, ["Decisions"], ["Information"]),
      fragment(3, ["Decisions"], ["Information"]),
    ];
    const result = checkDecisionCoverage(buildOutput(fragments));
    expect(result.status).toBe("Ok");
  });

  test("ignores sections with fewer than 3 fragments", () => {
    const fragments = [
      fragment(0, ["Reguły biznesowe"], ["Position"]),
      fragment(1, ["Reguły biznesowe"], ["Position"]),
    ];
    expect(checkDecisionCoverage(buildOutput(fragments)).status).toBe("Ok");
  });

  test("ignores sections without rule/decision-shaped headings", () => {
    const fragments = [
      fragment(0, ["Architektura modułu"], ["Information"]),
      fragment(1, ["Architektura modułu"], ["Information"]),
      fragment(2, ["Architektura modułu"], ["Information"]),
    ];
    expect(checkDecisionCoverage(buildOutput(fragments)).status).toBe("Ok");
  });

  test("formats the warning with section name and ratio", () => {
    const fragments = [
      fragment(0, ["ADR-005 FIFO"], ["Position"]),
      fragment(1, ["ADR-005 FIFO"], ["Position"]),
      fragment(2, ["ADR-005 FIFO"], ["Information"]),
      fragment(3, ["ADR-005 FIFO"], ["Position"]),
    ];
    const result = checkDecisionCoverage(buildOutput(fragments));
    const formatted = formatCheckResult(result);
    expect(formatted).toContain("ADR-005 FIFO");
    expect(formatted).toContain("0/4");
    expect(formatted).toContain("0%");
  });
});
