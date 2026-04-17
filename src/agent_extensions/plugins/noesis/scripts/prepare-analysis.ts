import { mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { z } from "zod";
import { exitError, outputResult, parseArgs, readJson, requireFile } from "./io.js";
import { getWorkingDir } from "./transcript/working-dir.js";
import {
  extractConversationId,
  isIdInKnowledgeGraph,
  prependConversationId,
} from "./transcript/check-conversation-id.js";
import { structureTranscript } from "./transcript/structure-transcript.js";
import { RawTranscriptSchema } from "./transcript/types.js";
import type { RawTurn } from "./transcript/types.js";
import { ConversationSchema } from "../shared-contracts/conversation.js";

const DEFAULT_TOKEN_LIMIT = 8000;
const CHARS_PER_TOKEN = 4;

const ChunkInfoSchema = z.object({
  chunk_id: z.number(),
  file: z.string(),
  num_turns: z.number(),
});

const PrepareResultSchema = z.object({
  status: z.enum(["Ok", "ConversationAlreadyAdded"]),
  working_dir: z.string(),
  conversation_id: z.string(),
  chunks: z.array(ChunkInfoSchema).optional(),
  structured_transcript_path: z.string().optional(),
});
type PrepareResult = z.infer<typeof PrepareResultSchema>;

// --- Public functions (alphabetical) ---

export function generateChunks(
  turns: RawTurn[],
  workingDir: string,
  tokenLimit: number,
): { chunk_id: number; file: string; num_turns: number }[] {
  const chunks: { chunk_id: number; file: string; num_turns: number }[] = [];
  let startIndex = 0;
  let chunkId = 0;

  while (startIndex < turns.length) {
    const remaining = turns.slice(startIndex);
    const selected = selectTurnsWithinLimit(remaining, tokenLimit);

    const chunkPath = join(workingDir, `chunk_${chunkId}.md`);
    const content = formatChunkMarkdown(selected, startIndex);
    Bun.write(chunkPath, content);

    chunks.push({
      chunk_id: chunkId,
      file: chunkPath,
      num_turns: selected.length,
    });

    startIndex += selected.length;
    chunkId++;
  }

  return chunks;
}

export function initConversation(
  workingDir: string,
  conversationId: string,
  time: string,
  mainTopic: string,
): string {
  const conversation = {
    conversation_id: conversationId,
    time,
    main_topic: mainTopic,
    turns: [],
    topics: [],
    decisions: [],
  };

  ConversationSchema.parse(conversation);

  const outputPath = join(workingDir, "conversation.json");
  const content = JSON.stringify(conversation, null, 2);
  Bun.write(outputPath, content);
  return outputPath;
}

export async function prepareAnalysis(
  transcriptPath: string,
  knowledgeGraphPath: string,
  conversationTime: string,
  mainTopic: string,
  tokenLimit: number = DEFAULT_TOKEN_LIMIT,
): Promise<PrepareResult> {
  const workingDir = getWorkingDir(transcriptPath);
  mkdirSync(workingDir, { recursive: true });

  const { conversationId, alreadyAdded } = resolveConversationId(
    transcriptPath,
    knowledgeGraphPath,
  );

  if (alreadyAdded) {
    return {
      status: "ConversationAlreadyAdded",
      working_dir: workingDir,
      conversation_id: conversationId,
    };
  }

  const structureResult = structureTranscript(transcriptPath, conversationId);
  if (structureResult.status === "Error") {
    exitError(structureResult.message!);
  }
  const structuredTranscriptPath = structureResult.output_path!;

  initConversation(workingDir, conversationId, conversationTime, mainTopic);

  const transcript = await readJson(RawTranscriptSchema, structuredTranscriptPath);
  const chunks = generateChunks(transcript.turns, workingDir, tokenLimit);

  return {
    status: "Ok",
    working_dir: workingDir,
    conversation_id: conversationId,
    chunks,
    structured_transcript_path: structuredTranscriptPath,
  };
}

// --- Private functions ---

function formatChunkMarkdown(turns: RawTurn[], startIndex: number): string {
  const lines: string[] = [];
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    lines.push(`### [${startIndex + i}] ${turn.time} — ${turn.speaker}`);
    for (const sentence of turn.sentences) {
      lines.push(`- ${sentence}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function estimateTurnChars(turn: RawTurn): number {
  return (
    turn.sentences.reduce((sum, s) => sum + s.length, 0) +
    turn.speaker.length +
    turn.time.length
  );
}

function resolveConversationId(
  transcriptPath: string,
  knowledgeGraphPath: string,
): { conversationId: string; alreadyAdded: boolean } {
  const existing = extractConversationId(transcriptPath);

  if (existing === null) {
    const newId = randomUUID();
    prependConversationId(newId, transcriptPath);
    return { conversationId: newId, alreadyAdded: false };
  }

  if (isIdInKnowledgeGraph(existing, knowledgeGraphPath)) {
    return { conversationId: existing, alreadyAdded: true };
  }

  return { conversationId: existing, alreadyAdded: false };
}

function selectTurnsWithinLimit(
  turns: RawTurn[],
  tokenLimit: number,
): RawTurn[] {
  const charLimit = tokenLimit * CHARS_PER_TOKEN;
  const selected: RawTurn[] = [];
  let charCount = 0;

  for (const turn of turns) {
    const turnChars = estimateTurnChars(turn);
    if (selected.length > 0 && charCount + turnChars > charLimit) {
      break;
    }
    selected.push(turn);
    charCount += turnChars;
  }

  return selected;
}

// --- Entry point ---

async function main(): Promise<void> {
  const args = parseArgs(
    ["transcript_path", "knowledge_graph_path", "conversation_time", "main_topic"],
    ["token_limit"],
  );
  requireFile(args["transcript_path"]);

  const tokenLimit = args["token_limit"]
    ? parseInt(args["token_limit"], 10)
    : DEFAULT_TOKEN_LIMIT;

  if (isNaN(tokenLimit) || tokenLimit <= 0) {
    exitError("token_limit must be a positive integer");
  }

  const result = await prepareAnalysis(
    args["transcript_path"],
    args["knowledge_graph_path"],
    args["conversation_time"],
    args["main_topic"],
    tokenLimit,
  );

  outputResult(result);
}

if (import.meta.main) {
  main();
}
