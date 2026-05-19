import { exitError, outputResult, parseArgs, requireFile } from "../io.js";
import { readJson } from "../io.js";
import {
  AnalyzeDesignDraftOutputSchema,
  type AnalyzeDesignDraftOutput,
} from "../../shared-contracts/skills/analyze-design-draft/output.js";

const SECTION_PATTERN = /(decision|adr|reguły|reguly|polityka)/iu;
const MIN_DECISION_RATIO = 0.3;
const MIN_FRAGMENTS_PER_SECTION = 3;

interface SectionStat {
  section: string;
  total: number;
  decisions: number;
  ratio: number;
}

interface CheckResult {
  status: "Ok" | "Warning";
  warnings: SectionStat[];
  document_id: string;
  fragments_total: number;
  fragments_with_decision: number;
}

export function checkDecisionCoverage(
  output: AnalyzeDesignDraftOutput,
): CheckResult {
  const stats = collectSectionStats(output);
  const warnings = stats.filter(isUnderCovered);
  const decisionTotal = output.document.fragments.filter(hasDecision).length;
  return {
    status: warnings.length === 0 ? "Ok" : "Warning",
    warnings,
    document_id: output.document.document_id,
    fragments_total: output.document.fragments.length,
    fragments_with_decision: decisionTotal,
  };
}

export function formatCheckResult(result: CheckResult): string {
  if (result.status === "Ok") {
    return [
      "Decision-coverage check: Ok.",
      `  fragments: ${result.fragments_total}, with Decision: ${result.fragments_with_decision}`,
    ].join("\n");
  }
  const lines = [
    "Decision-coverage check: WARNING — narrative-decision sections under-classified.",
    "  Sections with rule/decision-shaped headings should have ≥30% Decision-categorised fragments.",
  ];
  for (const w of result.warnings) {
    lines.push(
      `  - "${w.section}" — ${w.decisions}/${w.total} (${(w.ratio * 100).toFixed(0)}%) Decision-categorised`,
    );
  }
  lines.push(
    "  Re-read these sections looking for narrative decisions (`ponieważ`, `zamiast`, `zdecydowaliśmy się na`, `we chose`, `rather than`).",
  );
  return lines.join("\n");
}

// --- Private helpers ---

function collectSectionStats(output: AnalyzeDesignDraftOutput): SectionStat[] {
  const buckets = new Map<string, { total: number; decisions: number }>();
  for (const f of output.document.fragments) {
    const candidate = pickRelevantSection(f.section_path);
    if (candidate === null) continue;
    const slot = buckets.get(candidate) ?? { total: 0, decisions: 0 };
    slot.total++;
    if (hasDecision(f)) slot.decisions++;
    buckets.set(candidate, slot);
  }
  const stats: SectionStat[] = [];
  for (const [section, agg] of buckets) {
    stats.push({
      section,
      total: agg.total,
      decisions: agg.decisions,
      ratio: agg.total > 0 ? agg.decisions / agg.total : 0,
    });
  }
  return stats.sort((a, b) => a.section.localeCompare(b.section));
}

function pickRelevantSection(path: string[]): string | null {
  for (let i = 0; i < path.length; i++) {
    if (SECTION_PATTERN.test(path[i])) {
      return path.slice(0, i + 1).join(" / ");
    }
  }
  return null;
}

function hasDecision(f: { categories: string[] }): boolean {
  return f.categories.includes("Decision");
}

function isUnderCovered(stat: SectionStat): boolean {
  if (stat.total < MIN_FRAGMENTS_PER_SECTION) return false;
  return stat.ratio < MIN_DECISION_RATIO;
}

// --- Entry point ---

async function main(): Promise<void> {
  const args = parseArgs(["output_path"]);
  requireFile(args["output_path"]);

  try {
    const output = await readJson(
      AnalyzeDesignDraftOutputSchema,
      args["output_path"],
    );
    const result = checkDecisionCoverage(output);
    if (result.status === "Warning") {
      process.stderr.write(formatCheckResult(result) + "\n");
    }
    outputResult(result);
  } catch (err) {
    exitError(err instanceof Error ? err.message : String(err));
  }
}

if (import.meta.main) {
  main();
}
