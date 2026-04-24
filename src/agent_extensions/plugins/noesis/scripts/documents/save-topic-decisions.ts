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
  AttachToDecisionSchema,
  DocumentAnalysisSchema,
  type AttachToDecision,
  type DocumentAnalysis,
} from "../../shared-contracts/document-analysis.js";
import { DecisionSchema } from "../../shared-contracts/topics.js";
import { findTopicOrFail } from "../topics/topic-helpers.js";
import { findFragmentOrFail } from "./document-helpers.js";

export const DecisionExtractionResultSchema = z.object({
  topic_id: z.string(),
  decisions: z.array(DecisionSchema),
  attachments: z.array(AttachToDecisionSchema).default(() => []),
});
export type DecisionExtractionResult = z.infer<typeof DecisionExtractionResultSchema>;

export function saveTopicDecisions(
  analysis: DocumentAnalysis,
  result: DecisionExtractionResult,
): void {
  const topic = findTopicOrFail(analysis.topics, result.topic_id);
  topic.decisions.push(...result.decisions);
  topic.decisions_extracted = true;
  for (const attachment of result.attachments) {
    validateAttachment(analysis, attachment);
    analysis.decision_attachments.push(attachment);
  }
}

// --- Private functions ---

function validateAttachment(
  analysis: DocumentAnalysis,
  attachment: AttachToDecision,
): void {
  if (attachment.slot === "alternative" && attachment.alternative_index === null) {
    throw new Error(
      `Attachment to decision ${attachment.decision_id} with slot=alternative requires alternative_index`,
    );
  }
  for (const fi of attachment.fragment_indices) {
    findFragmentOrFail(analysis, fi);
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
  const result = await readJson(DecisionExtractionResultSchema, args["input_file"]);

  saveTopicDecisions(analysis, result);
  await writeJson(join(args["working_dir"], "analysis.json"), analysis);
  deleteFile(args["input_file"]);

  outputResult({
    status: "Ok",
    topic_id: result.topic_id,
    decisions_saved: result.decisions.length,
    attachments_saved: result.attachments.length,
  });
}

if (import.meta.main) {
  main();
}
