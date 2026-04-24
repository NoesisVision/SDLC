import { join } from "path";
import { z } from "zod";
import {
  deleteFile,
  outputResult,
  parseArgs,
  readJson,
  requireDir,
  requireFile,
  writeJson,
} from "../io.js";
import {
  DocumentAnalysisSchema,
  type DocumentAnalysis,
} from "../../shared-contracts/document-analysis.js";
import {
  PotentialTopicSchema,
  PotentialTopicsSchema,
} from "../../shared-contracts/topics.js";
import type { Topic } from "../../shared-contracts/topics.js";
import { assertNever } from "../../shared-contracts/assert-never.js";
import {
  appendNewTopics,
  createTopicFromPotential,
  findTopicOrFail,
  replacePlaceholderIds,
} from "../topics/topic-helpers.js";
import { findFragmentOrFail } from "./document-helpers.js";

export const FragmentReassignmentSchema = z.object({
  fragment_index: z.int(),
  new_topic_id: z.string(),
});
export type FragmentReassignment = z.infer<typeof FragmentReassignmentSchema>;

export const TopicReviewResultSchema = z.object({
  topic_id: z.string(),
  short_summary: z.string(),
  long_summary: z.string(),
  reassignments: z.array(FragmentReassignmentSchema),
  new_topics: z.array(PotentialTopicSchema),
});
export type TopicReviewResult = z.infer<typeof TopicReviewResultSchema>;

export function saveTopicReview(
  analysis: DocumentAnalysis,
  review: TopicReviewResult,
): void {
  const topic = findTopicOrFail(analysis.topics, review.topic_id);
  topic.short_summary = review.short_summary;
  topic.long_summary = review.long_summary;
  applyReassignments(analysis, topic, review);
  topic.reviewed = true;
}

// --- Private functions ---

function applyReassignments(
  analysis: DocumentAnalysis,
  sourceTopic: Topic,
  review: TopicReviewResult,
): void {
  const topicMap = new Map(analysis.topics.map((t) => [t.id, t]));
  const reassignedOffsets = new Set<string>();
  for (const r of review.reassignments) {
    const fragment = findFragmentOrFail(analysis, r.fragment_index);
    reassignedOffsets.add(offsetKey(fragment.start_offset, fragment.end_offset));
  }

  sourceTopic.items = sourceTopic.items.filter((item) => {
    switch (item.type) {
      case "idea_unit_ref":
        return true;
      case "document_fragment_ref":
        if (item.document_id !== analysis.document_id) return true;
        return !reassignedOffsets.has(offsetKey(item.start_offset, item.end_offset));
      default:
        return assertNever(item);
    }
  });

  for (const reassignment of review.reassignments) {
    let target = topicMap.get(reassignment.new_topic_id);
    if (target === undefined) {
      target = createTopicFromPotential(reassignment.new_topic_id, review.new_topics);
      analysis.topics.push(target);
      topicMap.set(target.id, target);
    }
    const fragment = findFragmentOrFail(analysis, reassignment.fragment_index);
    target.items.push({
      type: "document_fragment_ref",
      document_id: analysis.document_id,
      start_offset: fragment.start_offset,
      end_offset: fragment.end_offset,
    });
  }
}

function offsetKey(start: number, end: number): string {
  return `${start}:${end}`;
}

// --- Entry point ---

async function main(): Promise<void> {
  const args = parseArgs(["working_dir", "input_file"]);
  requireDir(args["working_dir"]);
  requireFile(args["input_file"]);

  const analysis = await readJson(
    DocumentAnalysisSchema,
    join(args["working_dir"], "analysis.json"),
  );
  const review = await readJson(TopicReviewResultSchema, args["input_file"]);

  replacePlaceholderIds(review.new_topics, (oldId, newId) => {
    for (const r of review.reassignments) {
      if (r.new_topic_id === oldId) r.new_topic_id = newId;
    }
  });
  saveTopicReview(analysis, review);
  await writeJson(join(args["working_dir"], "analysis.json"), analysis);

  if (review.new_topics.length > 0) {
    const potentialPath = join(args["working_dir"], "potential_topics.json");
    const existing = await readJson(PotentialTopicsSchema, potentialPath);
    const merged = appendNewTopics(existing.topics, review.new_topics);
    await writeJson(potentialPath, { topics: merged });
  }

  deleteFile(args["input_file"]);

  outputResult({
    status: "Ok",
    topic_id: review.topic_id,
    reassignments: review.reassignments.length,
    new_topics: review.new_topics.length,
  });
}

if (import.meta.main) {
  main();
}
