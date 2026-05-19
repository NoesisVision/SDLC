import { describe, expect, test } from "bun:test";
import {
  cleanTextBlock,
  detectLanguage,
  normalizeEncoding,
  normalizeTime,
  parseTranscript,
  splitSentences,
  stripConversationIdLine,
} from "./structure-transcript.js";

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

describe("parseTranscript", () => {
  test("parses transcript with speaker turns", () => {
    const raw = `<!-- conversation_id: test-id -->
**0:30**
Alice
Hello everyone, welcome to the meeting. Let's discuss the new feature.

**1:15**
Bob
I think we should start with the database schema. It needs careful planning.
`;
    const result = parseTranscript(raw, "test-id");
    expect(result.status).toBe("Ok");
    if (result.status !== "Ok") return;
    expect(result.transcript.conversation_id).toBe("test-id");
    expect(result.transcript.turns.length).toBe(2);
    expect(result.transcript.turns[0].speaker).toBe("Alice");
    expect(result.transcript.turns[0].time).toBe("00:00:30");
    expect(result.transcript.turns[0].sentences.length).toBeGreaterThan(0);
    expect(result.transcript.turns[1].speaker).toBe("Bob");
  });

  test("returns Error for empty transcript", () => {
    const result = parseTranscript("", "id");
    expect(result.status).toBe("Error");
  });

  test("returns Error when no speaker turns found", () => {
    const result = parseTranscript("Just some text without any speaker format.", "id");
    expect(result.status).toBe("Error");
  });
});
