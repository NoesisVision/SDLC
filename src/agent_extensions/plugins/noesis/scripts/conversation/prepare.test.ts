import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
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
  test("renders header comments and turns", () => {
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
    const md = buildCleanedMarkdown("cid", "2026-04-25 12:00:00", "topic-x", transcript);
    expect(md).toContain("<!-- conversation_id: cid -->");
    expect(md).toContain("<!-- time: 2026-04-25 12:00:00 -->");
    expect(md).toContain("<!-- main_topic: topic-x -->");
    expect(md).toContain("### [0] 00:00:30 — Alice");
    expect(md).toContain("- Hello.");
    expect(md).toContain("### [1] 00:01:00 — Bob");
  });
});

describe("prepareConversation", () => {
  test("generates id, writes cleaned file under noesis/conversations/, initialises output.json", () => {
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
    expect(result.cleaned_path).toBe(
      join(tmpDir, "noesis", "conversations", `${result.conversation_id}.md`),
    );
    expect(existsSync(result.cleaned_path)).toBe(true);
    expect(result.working_dir).toBe(
      join(tmpDir, "noesis:analyze-conversation", result.conversation_id),
    );
    expect(existsSync(result.output_path)).toBe(true);
    expect(result.num_turns).toBe(2);

    const cleaned = readFileSync(result.cleaned_path, "utf-8");
    expect(cleaned).toContain(`<!-- conversation_id: ${result.conversation_id} -->`);

    const output = JSON.parse(readFileSync(result.output_path, "utf-8"));
    expect(output.conversation.conversation_id).toBe(result.conversation_id);
    expect(output.conversation.turns).toEqual([]);
    expect(output.conversation.topics).toEqual([]);
    expect(output.potential_topics).toEqual({ topics: [] });
  });

  test("reuses existing conversation_id from cleaned file on rerun", () => {
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
