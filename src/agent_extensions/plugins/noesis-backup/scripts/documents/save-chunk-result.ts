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
import { IdeaUnitCategory } from "../../shared-contracts/conversation.js";
import {
  PotentialTopicSchema,
  PotentialTopicsSchema,
} from "../../shared-contracts/topics.js";
import type { Topic } from "../../shared-contracts/topics.js";
import {
  appendNewTopics,
  createTopicFromPotential,
  replacePlaceholderIds,
} from "../topics/topic-helpers.js";
import { applyFragmentCategories, findFragmentOrFail } from "./document-helpers.js";

export const FragmentCategoriesSchema = z.object({
  fragment_index: z.int(),
  categories: z.array(IdeaUnitCategory),
});
export type FragmentCategories = z.infer<typeof FragmentCategoriesSchema>;

export const FragmentTopicAssignmentSchema = z.object({
  fragment_index: z.int(),
  topic_id: z.string(),
});
export type FragmentTopicAssignment = z.infer<typeof FragmentTopicAssignmentSchema>;

export const ChunkResultSchema = z.object({
  fragment_categories: z.array(FragmentCategoriesSchema),
  assignments: z.array(FragmentTopicAssignmentSchema),
  new_topics: z.array(PotentialTopicSchema),
});
export type ChunkResult = z.infer<typeof ChunkResultSchema>;

export function saveChunkResult(
  analysis: DocumentAnalysis,
  chunkResult: ChunkResult,
): void {
  applyFragmentCategories(analysis, chunkResult.fragment_categories);
  applyAssignments(analysis, chunkResult);
}

// --- Private functions ---

function applyAssignments(
  analysis: DocumentAnalysis,
  chunkResult: ChunkResult,
): void {
  const topicMap = new Map<string, Topic>(
    analysis.topics.map((t) => [t.id, t]),
  );

  for (const assignment of chunkResult.assignments) {
    let topic = topicMap.get(assignment.topic_id);
    if (topic === undefined) {
      topic = createTopicFromPotential(assignment.topic_id, chunkResult.new_topics);
      analysis.topics.push(topic);
      topicMap.set(topic.id, topic);
    }

    const fragment = findFragmentOrFail(analysis, assignment.fragment_index);
    topic.items.push({
      type: "document_fragment_ref",
      document_id: analysis.document_id,
      start_offset: fragment.start_offset,
      end_offset: fragment.end_offset,
    });
  }
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
  const chunkResult = await readJson(ChunkResultSchema, args["input_file"]);

  replacePlaceholderIds(chunkResult.new_topics, (oldId, newId) => {
    for (const a of chunkResult.assignments) {
      if (a.topic_id === oldId) a.topic_id = newId;
    }
  });
  saveChunkResult(analysis, chunkResult);
  await writeJson(join(args["working_dir"], "analysis.json"), analysis);

  if (chunkResult.new_topics.length > 0) {
    const potentialPath = join(args["working_dir"], "potential_topics.json");
    const existing = await readJson(PotentialTopicsSchema, potentialPath);
    const merged = appendNewTopics(existing.topics, chunkResult.new_topics);
    await writeJson(potentialPath, { topics: merged });
  }

  deleteFile(args["input_file"]);

  outputResult({
    status: "Ok",
    fragments_categorized: chunkResult.fragment_categories.length,
    assignments: chunkResult.assignments.length,
    new_topics: chunkResult.new_topics.length,
  });
}

if (import.meta.main) {
  main();
}
