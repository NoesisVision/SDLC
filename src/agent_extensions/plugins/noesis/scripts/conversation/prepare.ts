import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { createHash } from "crypto";
import { exitError, outputResult, parseArgs, requireFile } from "../io.js";
import { parseTranscript } from "./structure-transcript.js";
import { CONVERSATION_ID_PATTERN, type RawTranscript } from "./types.js";
import {
  AnalyzeConversationOutputSchema,
  type AnalyzeConversationOutput,
} from "../../shared-contracts/skills/analyze-conversation/output.js";
import { resolveWorkingDir } from "../../shared-contracts/plugin-paths.js";
import { conversationMdPath } from "../../shared-contracts/source-files.js";

const SKILL_NAME = "noesis:analyze-conversation";
const FILE_MODE = 0o600;

interface PrepareOptions {
  workingDirBase?: string;
  projectDir?: string;
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
  transcript: RawTranscript
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

export function getCanonicalConversationPath(projectDir: string, conversationId: string): string {
  return conversationMdPath(projectDir, conversationId);
}

export function prepareConversation(
  transcriptPath: string,
  conversationTime: string,
  mainTopic: string,
  options: PrepareOptions = {}
): PrepareResult {
  const projectDir = resolveProjectDir(options.projectDir);

  const rawText = readFileSync(transcriptPath, "utf-8");
  const conversationId = resolveConversationId(rawText);
  const cleanedPath = getCanonicalConversationPath(projectDir, conversationId);

  const parsed = parseTranscript(rawText, conversationId);
  if (parsed.status === "Error") {
    throw new Error(parsed.message);
  }

  const cleanedMarkdown = buildCleanedMarkdown(
    conversationId,
    conversationTime,
    mainTopic,
    parsed.transcript
  );
  mkdirSync(dirname(cleanedPath), { recursive: true });
  writeFileSync(cleanedPath, cleanedMarkdown, "utf-8");

  const workingDir = resolveWorkingDir(SKILL_NAME, conversationId, options.workingDirBase);

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

function extractIdFromContent(content: string): string | null {
  const firstLine = content.split("\n", 1)[0];
  const match = CONVERSATION_ID_PATTERN.exec(firstLine);
  return match !== null ? match[1] : null;
}

function deriveIdFromContent(content: string): string {
  const hex = createHash("sha256").update(content).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function resolveConversationId(rawText: string): string {
  const stamped = extractIdFromContent(rawText);
  if (stamped !== null) return stamped;
  return deriveIdFromContent(rawText);
}

function resolveProjectDir(explicit: string | undefined): string {
  if (explicit !== undefined && explicit !== "") return explicit;
  const fromEnv = process.env["CLAUDE_PROJECT_DIR"] ?? process.env["NOESIS_PROJECT_DIR"];
  if (fromEnv === undefined || fromEnv === "") {
    throw new Error("Project directory is required. Set CLAUDE_PROJECT_DIR or NOESIS_PROJECT_DIR.");
  }
  return fromEnv;
}

// --- Entry point ---

function main(): void {
  const args = parseArgs(["transcript_path", "conversation_time", "main_topic"]);
  requireFile(args["transcript_path"]);

  try {
    const result = prepareConversation(
      args["transcript_path"],
      args["conversation_time"],
      args["main_topic"]
    );
    outputResult(result);
  } catch (err) {
    exitError(err instanceof Error ? err.message : String(err));
  }
}

if (import.meta.main) {
  main();
}
