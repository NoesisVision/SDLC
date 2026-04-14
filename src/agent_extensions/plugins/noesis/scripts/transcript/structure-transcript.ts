import { readFileSync, writeFileSync } from "fs";
import sentencex from "sentencex";
import { detect } from "tinyld";
import { exitError, outputResult, parseArgs, requireFile } from "../io.js";
import type { RawTurn } from "./types.js";
import { CONVERSATION_ID_PATTERN, RawTranscriptSchema } from "./types.js";
import { getWorkingDir } from "./working-dir.js";
import { basename, join } from "path";

const LANGUAGE_SAMPLE_SIZE = 1000;

const INVISIBLE_CHARS = /[\u200b\u200c\u200d\u200e\u200f\ufeff\u2028\u2029]/g;
const MULTI_SPACES = / {2,}/g;
const CAPITALIZE_AFTER_PUNCTUATION = /([.!?]\s+)([a-z])/g;
const ENCODING_ARTIFACTS: [string, string][] = [
  ["\u00c3\u00a9", "\u00e9"],
  ["\u00c3\u00a8", "\u00e8"],
  ["\u00c3\u00bc", "\u00fc"],
  ["\u00c3\u00b6", "\u00f6"],
  ["\u00c3\u00a4", "\u00e4"],
];
const SMART_QUOTES: [string, string][] = [
  ["\u201c", '"'],
  ["\u201d", '"'],
  ["\u2018", "'"],
  ["\u2019", "'"],
  ["\u2013", "-"],
  ["\u2014", "--"],
];

const TIME = String.raw`\d{1,2}:\d{2}(?::\d{2})?`;
const TURN_PATTERN = new RegExp(
  String.raw`\*\*(${TIME})\*\*\s*\n(.+?)\n([\s\S]*?)(?=\*\*${TIME}\*\*|$)`,
  "gm",
);
const BROKEN_TIME_MARKER = new RegExp(
  String.raw`^\*\*\s*(${TIME})\s*\*\*`,
  "gm",
);
const SPEAKER_ON_TIMESTAMP_LINE = new RegExp(
  String.raw`^(\*\*${TIME}\*\*)[ \t]+(.+)$`,
  "gm",
);

export function structureTranscript(
  filePath: string,
  conversationId: string,
): { status: string; output_path?: string; message?: string } {
  const rawText = readFileSync(filePath, "utf-8");

  const body = stripConversationIdLine(rawText);
  if (!body.trim()) {
    return { status: "Error", message: `File is empty: ${filePath}` };
  }

  const normalized = normalizeEncoding(body);
  const stripped = stripPreamble(normalized);
  const language = detectLanguage(stripped);
  const turns = parseSpeakerTurns(stripped, language);

  if (turns.length === 0) {
    return {
      status: "Error",
      message: `No recognizable speaker turns found in: ${filePath}`,
    };
  }

  const transcript = { conversation_id: conversationId, turns };
  RawTranscriptSchema.parse(transcript);

  const stem = basename(filePath).replace(/\.[^.]+$/, "");
  const outputPath = join(getWorkingDir(filePath), `${stem}.json`);
  writeFileSync(outputPath, JSON.stringify(transcript, null, 2), "utf-8");

  return { status: "Ok", output_path: outputPath };
}

export function stripConversationIdLine(text: string): string {
  const newlineIndex = text.indexOf("\n");
  const firstLine = newlineIndex === -1 ? text : text.slice(0, newlineIndex);
  if (CONVERSATION_ID_PATTERN.test(firstLine)) {
    return newlineIndex === -1 ? "" : text.slice(newlineIndex + 1);
  }
  return text;
}

export function normalizeEncoding(text: string): string {
  let result = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  result = result.replace(/\u00a0/g, " ");
  result = result.replace(INVISIBLE_CHARS, "");

  for (const [bad, good] of ENCODING_ARTIFACTS) {
    result = result.replaceAll(bad, good);
  }
  for (const [smart, straight] of SMART_QUOTES) {
    result = result.replaceAll(smart, straight);
  }
  return result;
}

export function detectLanguage(text: string): string {
  const mid = Math.floor(text.length / 2);
  const halfSample = Math.floor(LANGUAGE_SAMPLE_SIZE / 2);
  const startSample = text.slice(0, halfSample);
  const midSample = text.slice(mid - halfSample, mid + halfSample);
  const sample = startSample + " " + midSample;
  try {
    const detected = detect(sample);
    return detected || "en";
  } catch {
    return "en";
  }
}

export function normalizeTime(timeStr: string): string {
  const parts = timeStr.split(":");
  if (parts.length === 2) {
    return `00:${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}`;
  }
  return `${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}:${parts[2].padStart(2, "0")}`;
}

export function splitSentences(text: string, language: string): string[] {
  const sentences = [...sentencex(language, text)];
  return sentences.map((s) => s.trim()).filter((s) => s.length > 0);
}

export function cleanTextBlock(text: string): string {
  const trimmed = text.trim();
  const lines = trimmed
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  let joined = lines.join(" ");
  joined = joined.replace(MULTI_SPACES, " ");
  joined = joined.replace(CAPITALIZE_AFTER_PUNCTUATION, (_, punct, letter) =>
    punct + letter.toUpperCase(),
  );
  return joined;
}

function stripPreamble(text: string): string {
  const match = new RegExp(
    String.raw`\*\*(${TIME})\*\*\s*\n`,
    "m",
  ).exec(text);
  if (match) {
    return text.slice(match.index);
  }
  return text;
}

function normalizeHeaders(text: string): string {
  let result = text.replace(BROKEN_TIME_MARKER, "**$1**");
  result = result.replace(SPEAKER_ON_TIMESTAMP_LINE, "$1\n$2");
  return result;
}

function parseSpeakerTurns(body: string, language: string): RawTurn[] {
  const normalized = normalizeHeaders(body);
  const turns: RawTurn[] = [];

  TURN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TURN_PATTERN.exec(normalized)) !== null) {
    const time = match[1];
    const speaker = match[2].trim();
    const rawText = match[3];

    const cleaned = cleanTextBlock(rawText);
    if (!cleaned) continue;

    const sentences = splitSentences(cleaned, language);
    if (sentences.length > 0) {
      turns.push({ speaker, time: normalizeTime(time), sentences });
    }
  }

  return turns;
}

function main(): void {
  const args = parseArgs(["transcript_path", "conversation_id"]);
  requireFile(args["transcript_path"]);

  const result = structureTranscript(
    args["transcript_path"],
    args["conversation_id"],
  );
  if (result.status === "Error") {
    exitError(result.message!);
  }
  outputResult(result);
}

if (import.meta.main) {
  main();
}
