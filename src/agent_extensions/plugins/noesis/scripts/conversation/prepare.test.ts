import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  buildCleanedMarkdown,
  prepareConversation,
} from "./prepare.js";
import type { RawTranscript } from "./types.js";

const tmpDir = mkdtempSync(join(import.meta.dirname, ".tmp-prepare-conv-"));
const SCRIPT = join(import.meta.dirname, "prepare.ts");

function runScript(...args: string[]) {
  const result = Bun.spawnSync(["bun", "run", SCRIPT, ...args]);
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("buildCleanedMarkdown", () => {
  test("renders time and main_topic stamps plus turns, with no conversation_id stamp", () => {
    const transcript: RawTranscript = {
      conversation_id: "cid",
      turns: [
        {
          speaker: "Alice",
          time: "00:00:30",
          sentences: ["Hello.", "How are you?"],
        },
        { speaker: "Bob", time: "00:01:00", sentences: ["Fine."] },
      ],
    };
    const md = buildCleanedMarkdown("2026-04-25 12:00:00", "topic-x", transcript);
    expect(md).not.toContain("conversation_id:");
    expect(md).toContain("<!-- time: 2026-04-25 12:00:00 -->");
    expect(md).toContain("<!-- main_topic: topic-x -->");
    expect(md).toContain("### [0] 00:00:30 — Alice");
    expect(md).toContain("- Hello.");
    expect(md).toContain("### [1] 00:01:00 — Bob");
  });
});

describe("prepareConversation", () => {
  test("hashes the raw transcript, writes cleaned md to the working dir, never to noesis", () => {
    const transcriptPath = join(tmpDir, "meeting.md");
    writeFileSync(
      transcriptPath,
      `**0:30**
Alice
Hello everyone, welcome to the meeting. Let's discuss the new feature.

**1:15**
Bob
I think we should start with the database schema. It needs careful planning.
`,
    );

    const result = prepareConversation(
      transcriptPath,
      "2026-04-25 10:00:00",
      "Database design",
      { workingDirBase: tmpDir, projectDir: tmpDir },
    );

    expect(result.status).toBe("Ok");
    expect(result.conversation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(result.working_dir).toBe(
      join(tmpDir, "noesis:analyze-conversation", result.conversation_id),
    );
    expect(result.cleaned_path).toBe(join(result.working_dir, "cleaned.md"));
    expect(existsSync(result.cleaned_path)).toBe(true);
    expect(existsSync(result.output_path)).toBe(true);
    expect(result.num_turns).toBe(2);

    const cleaned = readFileSync(result.cleaned_path, "utf-8");
    expect(cleaned).not.toContain("conversation_id:");
    expect(cleaned).toContain("<!-- main_topic: Database design -->");

    const output = JSON.parse(readFileSync(result.output_path, "utf-8"));
    expect(output.conversation.conversation_id).toBe(result.conversation_id);
    expect(output.conversation.turns).toEqual([]);
    expect(output.conversation.topics).toEqual([]);
    expect(output.potential_topics).toEqual({ topics: [] });

    const noesisDir = join(tmpDir, "noesis");
    if (existsSync(noesisDir)) {
      const found = readdirSync(noesisDir, { recursive: true }) as string[];
      expect(found.filter((p) => p.endsWith(".md"))).toEqual([]);
    }
  });

  test("rerun on the same raw transcript bytes produces the same content-hash id", () => {
    const transcriptPath = join(tmpDir, "rerun.md");
    writeFileSync(
      transcriptPath,
      `**0:30**
Alice
Sentence one. Sentence two.
`,
    );
    const first = prepareConversation(transcriptPath, "t", "m", {
      workingDirBase: tmpDir,
      projectDir: tmpDir,
    });
    const second = prepareConversation(transcriptPath, "t", "m", {
      workingDirBase: tmpDir,
      projectDir: tmpDir,
    });
    expect(second.conversation_id).toBe(first.conversation_id);
  });
});

describe("prepare_conversation script", () => {
  test("exits with code 1 when transcript file does not exist", () => {
    const result = runScript("/nonexistent/file.md", "t", "m");
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
