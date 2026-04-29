import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { exitError, outputResult, parseArgs, requireFile } from "../io.js";
import { parseTranscript } from "./structure-transcript.js";
import { CONVERSATION_ID_PATTERN, type RawTranscript } from "./types.js";
import {
  AnalyzeConversationOutputSchema,
  type AnalyzeConversationOutput,
} from "../../shared-contracts/skills/analyze-conversation/output.js";
import { resolveWorkingDir } from "../../shared-contracts/plugin-paths.js";

const SKILL_NAME = "noesis:analyze-conversation";
const FILE_MODE = 0o600;

interface PrepareOptions {
  workingDirBase?: string;
}

interface PrepareResult {
  status: "Ok";
  working_dir: string;
  conversation_id: string;
  cleaned_path: string;
  output_path: string;
  num_turns: number;
}

// --- Public functions ---

export function buildCleanedMarkdown(
  conversationId: string,
  time: string,
  mainTopic: string,
  transcript: RawTranscript,
): string {
  const lines: string[] = [];
  lines.push(`<!-- conversation_id: ${conversationId} -->`);
  lines.push(`<!-- time: ${time} -->`);
  lines.push(`<!-- main_topic: ${mainTopic} -->`);
  lines.push("");
  for (let i = 0; i < transcript.turns.length; i++) {
    const turn = transcript.turns[i];
    lines.push(`### [${i}] ${turn.time} — ${turn.speaker}`);
    for (const sentence of turn.sentences) {
      lines.push(`- ${sentence}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function getCleanedPath(transcriptPath: string): string {
  return transcriptPath.replace(/\.[^./]+$/, "") + "-cleaned.md";
}

export function prepareConversation(
  transcriptPath: string,
  conversationTime: string,
  mainTopic: string,
  options: PrepareOptions = {},
): PrepareResult {
  const cleanedPath = getCleanedPath(transcriptPath);

  const conversationId = resolveConversationId(transcriptPath, cleanedPath);

  const rawText = readFileSync(transcriptPath, "utf-8");
  const parsed = parseTranscript(rawText, conversationId);
  if (parsed.status === "Error") {
    throw new Error(parsed.message);
  }

  const cleanedMarkdown = buildCleanedMarkdown(
    conversationId,
    conversationTime,
    mainTopic,
    parsed.transcript,
  );
  writeFileSync(cleanedPath, cleanedMarkdown, "utf-8");

  const workingDir = resolveWorkingDir(
    SKILL_NAME,
    conversationId,
    options.workingDirBase,
  );

  const output: AnalyzeConversationOutput = {
    conversation: {
      conversation_id: conversationId,
      time: conversationTime,
      main_topic: mainTopic,
      turns: [],
      topics: [],
    },
    potential_topics: { topics: [] },
  };
  AnalyzeConversationOutputSchema.parse(output);
  const outputPath = join(workingDir, "output.json");
  writeFileSync(outputPath, JSON.stringify(output, null, 2), {
    encoding: "utf-8",
    mode: FILE_MODE,
  });

  return {
    status: "Ok",
    working_dir: workingDir,
    conversation_id: conversationId,
    cleaned_path: cleanedPath,
    output_path: outputPath,
    num_turns: parsed.transcript.turns.length,
  };
}

// --- Private functions ---

function readIdFromHeader(path: string): string | null {
  if (!existsSync(path)) return null;
  const firstLine = readFileSync(path, "utf-8").split("\n", 1)[0];
  const match = CONVERSATION_ID_PATTERN.exec(firstLine);
  return match !== null ? match[1] : null;
}

function resolveConversationId(transcriptPath: string, cleanedPath: string): string {
  const fromCleaned = readIdFromHeader(cleanedPath);
  if (fromCleaned !== null) return fromCleaned;
  const fromSource = readIdFromHeader(transcriptPath);
  if (fromSource !== null) return fromSource;
  return randomUUID();
}

// --- Entry point ---

function main(): void {
  const args = parseArgs(["transcript_path", "conversation_time", "main_topic"]);
  requireFile(args["transcript_path"]);

  try {
    const result = prepareConversation(
      args["transcript_path"],
      args["conversation_time"],
      args["main_topic"],
    );
    outputResult(result);
  } catch (err) {
    exitError(err instanceof Error ? err.message : String(err));
  }
}

if (import.meta.main) {
  main();
}
