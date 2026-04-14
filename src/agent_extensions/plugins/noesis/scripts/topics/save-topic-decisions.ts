import { join } from "path";
import { deleteFile, outputResult, parseArgs, readJson, requireDir, requireFile, writeJson } from "../io.js";
import { ConversationSchema } from "../conversation/types.js";
import type { Conversation } from "../conversation/types.js";
import { DecisionExtractionResultSchema, findTopicOrFail } from "./types.js";
import type { DecisionExtractionResult } from "./types.js";

export function saveTopicDecisions(
  conversation: Conversation,
  result: DecisionExtractionResult,
): void {
  const topic = findTopicOrFail(conversation.topics, result.topic_id);
  conversation.decisions.push(...result.decisions);
  topic.decisions_extracted = true;
}

// --- Entry point ---

async function main(): Promise<void> {
  const args = parseArgs(["working_dir", "input_file"]);
  requireDir(args["working_dir"]);
  requireFile(args["input_file"]);

  const conversation = await readJson(
    ConversationSchema,
    join(args["working_dir"], "conversation.json"),
  );
  const result = await readJson(
    DecisionExtractionResultSchema,
    args["input_file"],
  );

  saveTopicDecisions(conversation, result);
  await writeJson(join(args["working_dir"], "conversation.json"), conversation);
  deleteFile(args["input_file"]);

  outputResult({
    status: "Ok",
    topic_id: result.topic_id,
    decisions_saved: result.decisions.length,
  });
}

if (import.meta.main) {
  main();
}
