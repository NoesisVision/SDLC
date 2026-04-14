import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  cleanTextBlock,
  detectLanguage,
  normalizeEncoding,
  normalizeTime,
  splitSentences,
  stripConversationIdLine,
  structureTranscript,
} from "./structure-transcript.js";

const tmpDir = mkdtempSync(join(import.meta.dirname, ".tmp-test-"));
const SCRIPT = join(import.meta.dirname, "structure-transcript.ts");

function runScript(
  ...args: string[]
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["bun", "run", SCRIPT, ...args]);
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("stripConversationIdLine", () => {
  test("removes conversation_id comment from first line", () => {
    const input = "<!-- conversation_id: abc-123 -->\n# Meeting\nContent";
    expect(stripConversationIdLine(input)).toBe("# Meeting\nContent");
  });

  test("preserves text when no conversation_id comment present", () => {
    const input = "# Meeting\nContent";
    expect(stripConversationIdLine(input)).toBe(input);
  });
});

describe("normalizeEncoding", () => {
  test("converts Windows line endings to Unix", () => {
    expect(normalizeEncoding("line1\r\nline2\r\n")).toBe("line1\nline2\n");
  });

  test("replaces non-breaking spaces with regular spaces", () => {
    expect(normalizeEncoding("hello\u00a0world")).toBe("hello world");
  });

  test("removes invisible Unicode characters", () => {
    expect(normalizeEncoding("hel\u200blo\ufeff")).toBe("hello");
  });

  test("replaces smart quotes with straight quotes", () => {
    expect(normalizeEncoding("\u201cquoted\u201d")).toBe('"quoted"');
    expect(normalizeEncoding("\u2018single\u2019")).toBe("'single'");
  });

  test("fixes common encoding artifacts", () => {
    expect(normalizeEncoding("\u00c3\u00a9")).toBe("\u00e9");
  });
});

describe("detectLanguage", () => {
  test("detects English text", () => {
    const text =
      "This is a long enough text about software architecture and system design that should be detected as English by the language detection library.";
    expect(detectLanguage(text)).toBe("en");
  });

  test("returns en for very short or empty text", () => {
    expect(detectLanguage("")).toBe("en");
  });
});

describe("normalizeTime", () => {
  test("converts MM:SS to 00:MM:SS with padding", () => {
    expect(normalizeTime("5:30")).toBe("00:05:30");
  });

  test("normalizes HH:MM:SS with padding", () => {
    expect(normalizeTime("1:5:3")).toBe("01:05:03");
  });

  test("preserves already padded time", () => {
    expect(normalizeTime("01:30:45")).toBe("01:30:45");
  });
});

describe("splitSentences", () => {
  test("splits text into individual sentences", () => {
    const result = splitSentences(
      "Hello Mr. Smith. How are you? Fine, thanks.",
      "en",
    );
    expect(result.length).toBe(3);
    expect(result[0]).toContain("Mr. Smith");
    expect(result[1]).toContain("How are you");
    expect(result[2]).toContain("Fine");
  });

  test("returns empty array for empty text", () => {
    expect(splitSentences("", "en")).toEqual([]);
  });

  test("handles text with single sentence", () => {
    const result = splitSentences("Just one sentence here.", "en");
    expect(result.length).toBe(1);
  });
});

describe("cleanTextBlock", () => {
  test("joins multiline text into single line", () => {
    expect(cleanTextBlock("line one\nline two\nline three")).toBe(
      "line one line two line three",
    );
  });

  test("collapses multiple spaces", () => {
    expect(cleanTextBlock("too   many    spaces")).toBe("too many spaces");
  });

  test("trims leading and trailing whitespace", () => {
    expect(cleanTextBlock("  hello  ")).toBe("hello");
  });

  test("capitalizes after sentence-ending punctuation", () => {
    expect(cleanTextBlock("end. start")).toBe("end. Start");
  });

  test("removes blank lines", () => {
    expect(cleanTextBlock("line one\n\n\nline two")).toBe("line one line two");
  });
});

describe("structureTranscript", () => {
  test("parses transcript with speaker turns into structured JSON", () => {
    const transcriptDir = join(tmpDir, "struct_test");
    mkdirSync(transcriptDir, { recursive: true });
    mkdirSync(join(transcriptDir, "meeting_work"), { recursive: true });
    const transcriptPath = join(transcriptDir, "meeting.md");
    writeFileSync(
      transcriptPath,
      `<!-- conversation_id: test-id -->
**0:30**
Alice
Hello everyone, welcome to the meeting. Let's discuss the new feature.

**1:15**
Bob
I think we should start with the database schema. It needs careful planning.
`,
    );

    const result = structureTranscript(transcriptPath, "test-id");

    expect(result.status).toBe("Ok");
    expect(result.output_path).toBeDefined();
    expect(existsSync(result.output_path!)).toBe(true);

    const output = JSON.parse(readFileSync(result.output_path!, "utf-8"));
    expect(output.conversation_id).toBe("test-id");
    expect(output.turns.length).toBe(2);
    expect(output.turns[0].speaker).toBe("Alice");
    expect(output.turns[0].time).toBe("00:00:30");
    expect(output.turns[0].sentences.length).toBeGreaterThan(0);
    expect(output.turns[1].speaker).toBe("Bob");
  });

  test("returns error for empty file", () => {
    const path = join(tmpDir, "empty.md");
    writeFileSync(path, "");

    const result = structureTranscript(path, "id");

    expect(result.status).toBe("Error");
    expect(result.message).toContain("empty");
  });

  test("returns error when no speaker turns found", () => {
    const path = join(tmpDir, "no_turns.md");
    writeFileSync(path, "Just some text without any speaker format.");

    const result = structureTranscript(path, "id");

    expect(result.status).toBe("Error");
    expect(result.message).toContain("No recognizable speaker turns");
  });
});

describe("structure_transcript script", () => {
  test("exits with code 1 when transcript file does not exist", () => {
    const result = runScript("/nonexistent/file.md", "some-id");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("File not found");
  });

  test("exits with code 1 when arguments are missing", () => {
    const result = runScript();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing required argument");
  });
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});
