import { writeFileSync } from "fs";
import { join } from "path";
import { outputResult, parseArgs, readJson, requireDir } from "../io.js";
import {
  DocumentAnalysisSchema,
  buildFragmentMap,
  formatEnrichedDocumentTopicMarkdown,
  isIrrelevantFragment,
  resolveFragmentDetail,
  type DocumentAnalysis,
  type EnrichedDocumentTopic,
  type FragmentDetail,
} from "../../shared-contracts/document-analysis.js";
import type { Topic } from "../../shared-contracts/topics.js";
import { assertNever } from "../../shared-contracts/assert-never.js";

export function loadTopicForDecisions(
  analysis: DocumentAnalysis,
  topicId: string | null,
): EnrichedDocumentTopic | null {
  const topic =
    topicId !== null
      ? analysis.topics.find((t) => t.id === topicId) ?? null
      : analysis.topics.find((t) => !t.decisions_extracted) ?? null;

  if (topic === null) return null;

  const fragmentMap = buildFragmentMap(analysis.fragments);
  return enrichTopic(topic, fragmentMap, analysis.document_id);
}

// --- Private functions ---

function enrichTopic(
  topic: Topic,
  fragmentMap: Map<number, ReturnType<typeof buildFragmentMap> extends Map<number, infer V> ? V : never>,
  documentId: string,
): EnrichedDocumentTopic {
  const details: FragmentDetail[] = [];

  for (const item of topic.items) {
    switch (item.type) {
      case "document_fragment_ref": {
        if (item.document_id !== documentId) break;
        const fragmentIndex = findFragmentIndexByOffsets(
          fragmentMap,
          item.start_offset,
          item.end_offset,
        );
        if (fragmentIndex === null) break;
        const detail = resolveFragmentDetail(documentId, fragmentIndex, fragmentMap);
        if (detail === null || isIrrelevantFragment(detail.categories)) break;
        details.push(detail);
        break;
      }
      case "idea_unit_ref":
        break;
      default:
        assertNever(item);
    }
  }

  return {
    id: topic.id,
    title: topic.title,
    short_summary: topic.short_summary,
    long_summary: topic.long_summary,
    document_id: documentId,
    fragments: details,
  };
}

function findFragmentIndexByOffsets(
  fragmentMap: Map<number, { start_offset: number; end_offset: number }>,
  startOffset: number,
  endOffset: number,
): number | null {
  for (const [index, fragment] of fragmentMap.entries()) {
    if (fragment.start_offset === startOffset && fragment.end_offset === endOffset) {
      return index;
    }
  }
  return null;
}

// --- Entry point ---

async function main(): Promise<void> {
  const args = parseArgs(["working_dir"], ["topic_id"]);
  requireDir(args["working_dir"]);

  const analysis = await readJson(
    DocumentAnalysisSchema,
    join(args["working_dir"], "analysis.json"),
  );

  const topicId = args["topic_id"] ?? null;
  const topic = loadTopicForDecisions(analysis, topicId);

  if (topic === null) {
    outputResult({ status: "Ok", has_topic: false });
    return;
  }

  const topicPath = join(args["working_dir"], "decisions_topic.md");
  writeFileSync(topicPath, formatEnrichedDocumentTopicMarkdown(topic), "utf-8");

  outputResult({
    status: "Ok",
    has_topic: true,
    topic_id: topic.id,
    topic_title: topic.title,
    num_items: topic.fragments.length,
    topic_path: topicPath,
  });
}

if (import.meta.main) {
  main();
}
