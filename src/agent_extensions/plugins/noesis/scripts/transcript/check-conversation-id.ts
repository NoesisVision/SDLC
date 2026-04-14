import { readFileSync, writeFileSync } from "fs";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import { parseArgs, requireFile, outputResult } from "../io.js";
import { CONVERSATION_ID_PATTERN } from "./types.js";

export function extractConversationId(transcriptPath: string): string | null {
  const content = readFileSync(transcriptPath, "utf-8");
  const firstLine = content.split("\n", 1)[0];
  const match = CONVERSATION_ID_PATTERN.exec(firstLine);
  return match ? match[1] : null;
}

export function isIdInKnowledgeGraph(
  conversationId: string,
  knowledgeGraphPath: string,
): boolean {
  if (!existsSync(knowledgeGraphPath)) {
    return false;
  }
  const text = readFileSync(knowledgeGraphPath, "utf-8");
  return text.includes(`"conversation_id": "${conversationId}"`);
}

export function prependConversationId(
  conversationId: string,
  transcriptPath: string,
): void {
  const content = readFileSync(transcriptPath, "utf-8");
  writeFileSync(
    transcriptPath,
    `<!-- conversation_id: ${conversationId} -->\n${content}`,
    "utf-8",
  );
}

function main(): void {
  const args = parseArgs(["transcript_path", "knowledge_graph_path"]);
  requireFile(args["transcript_path"]);

  const conversationId = extractConversationId(args["transcript_path"]);

  if (conversationId === null) {
    const newId = randomUUID();
    prependConversationId(newId, args["transcript_path"]);
    outputResult({ status: "IdGenerated", conversation_id: newId });
  } else if (
    isIdInKnowledgeGraph(conversationId, args["knowledge_graph_path"])
  ) {
    outputResult({
      status: "ConversationAlreadyAdded",
      conversation_id: conversationId,
    });
  } else {
    outputResult({ status: "Ok", conversation_id: conversationId });
  }
}

if (import.meta.main) {
  main();
}
