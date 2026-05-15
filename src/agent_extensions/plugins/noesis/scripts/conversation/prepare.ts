import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { exitError, outputResult, parseArgs, requireFile } from "../io.js";
import { parseTranscript } from "./structure-transcript.js";
import { type RawTranscript } from "./types.js";
import {
  AnalyzeConversationOutputSchema,
  type AnalyzeConversationOutput,
} from "../../shared-contracts/skills/analyze-conversation/output.js";
import { resolveWorkingDir } from "../../shared-contracts/plugin-paths.js";
import { contentHashAsUuid } from "../../shared-contracts/uuid.js";

const SKILL_NAME = "noesis:analyze-conversation";
const FILE_MODE = 0o600;
const CLEANED_MD_FILENAME = "cleaned.md";

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
  time: string,
  mainTopic: string,
  transcript: RawTranscript
): string {
  const lines: string[] = [];
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

export function prepareConversation(
  transcriptPath: string,
  conversationTime: string,
  mainTopic: string,
  options: PrepareOptions = {}
): PrepareResult {
  resolveProjectDir(options.projectDir);

  const rawText = readFileSync(transcriptPath, "utf-8");
  const conversationId = contentHashAsUuid(rawText);

  const parsed = parseTranscript(rawText, conversationId);
  if (parsed.status === "Error") {
    throw new Error(parsed.message);
  }

  const workingDir = resolveWorkingDir(SKILL_NAME, conversationId, options.workingDirBase);
  mkdirSync(workingDir, { recursive: true });

  const cleanedPath = join(workingDir, CLEANED_MD_FILENAME);
  const cleanedMarkdown = buildCleanedMarkdown(
    conversationTime,
    mainTopic,
    parsed.transcript
  );
  mkdirSync(dirname(cleanedPath), { recursive: true });
  writeFileSync(cleanedPath, cleanedMarkdown, { encoding: "utf-8", mode: FILE_MODE });

  const output: AnalyzeConversationOutput = {
    conversation: {
      conversation_id: conversationId,
      time: conversationTime,
      main_topic: mainTopic,
      turns: [],
      topics: [],
    },
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
