import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  extractConversationId,
  isIdInKnowledgeGraph,
  prependConversationId,
} from "./check-conversation-id.js";

const tmpDir = mkdtempSync(join(import.meta.dirname, ".tmp-test-"));
const SCRIPT = join(import.meta.dirname, "check-conversation-id.ts");

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

describe("extractConversationId", () => {
  test("extracts id from transcript with conversation_id comment", () => {
    const path = join(tmpDir, "with_id.md");
    writeFileSync(path, "<!-- conversation_id: abc-123 -->\n# Meeting\nContent");

    expect(extractConversationId(path)).toBe("abc-123");
  });

  test("returns null when transcript has no conversation_id", () => {
    const path = join(tmpDir, "no_id.md");
    writeFileSync(path, "# Meeting\nContent here");

    expect(extractConversationId(path)).toBeNull();
  });

  test("extracts id with extra whitespace around it", () => {
    const path = join(tmpDir, "spaced_id.md");
    writeFileSync(path, "<!--   conversation_id:   def-456   -->\nContent");

    expect(extractConversationId(path)).toBe("def-456");
  });
});

describe("isIdInKnowledgeGraph", () => {
  test("returns true when conversation_id exists in knowledge graph", () => {
    const kgPath = join(tmpDir, "kg_exists.json");
    writeFileSync(
      kgPath,
      JSON.stringify({
        conversations: [{ conversation_id: "abc-123", time: "", main_topic: "", turns: [] }],
        topics: [],
        decisions: [],
      }, null, 2),
    );

    expect(isIdInKnowledgeGraph("abc-123", kgPath)).toBe(true);
  });

  test("returns false when conversation_id is not in knowledge graph", () => {
    const kgPath = join(tmpDir, "kg_other.json");
    writeFileSync(
      kgPath,
      JSON.stringify({
        conversations: [{ conversation_id: "other-id", time: "", main_topic: "", turns: [] }],
        topics: [],
        decisions: [],
      }, null, 2),
    );

    expect(isIdInKnowledgeGraph("abc-123", kgPath)).toBe(false);
  });

  test("returns false when knowledge graph file does not exist", () => {
    expect(isIdInKnowledgeGraph("abc-123", "/nonexistent/kg.json")).toBe(false);
  });
});

describe("prependConversationId", () => {
  test("prepends conversation_id comment to transcript file", () => {
    const path = join(tmpDir, "to_prepend.md");
    writeFileSync(path, "# Meeting\nContent");

    prependConversationId("new-id-789", path);

    const content = readFileSync(path, "utf-8");
    expect(content).toBe("<!-- conversation_id: new-id-789 -->\n# Meeting\nContent");
  });
});

describe("check_conversation_id script", () => {
  test("returns Ok when transcript has id not in knowledge graph", () => {
    const transcript = join(tmpDir, "script_ok.md");
    const kg = join(tmpDir, "script_kg.json");
    writeFileSync(transcript, "<!-- conversation_id: test-id -->\n# Meeting");
    writeFileSync(kg, JSON.stringify({ conversations: [], topics: [], decisions: [] }));

    const result = runScript(transcript, kg);
    const output = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(output.status).toBe("Ok");
    expect(output.conversation_id).toBe("test-id");
  });

  test("returns IdGenerated when transcript has no id", () => {
    const transcript = join(tmpDir, "script_no_id.md");
    const kg = join(tmpDir, "script_kg2.json");
    writeFileSync(transcript, "# Meeting\nContent");
    writeFileSync(kg, JSON.stringify({ conversations: [], topics: [], decisions: [] }));

    const result = runScript(transcript, kg);
    const output = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(output.status).toBe("IdGenerated");
    expect(output.conversation_id).toBeDefined();

    const content = readFileSync(transcript, "utf-8");
    expect(content).toStartWith(`<!-- conversation_id: ${output.conversation_id} -->`);
  });

  test("returns ConversationAlreadyAdded when id exists in knowledge graph", () => {
    const transcript = join(tmpDir, "script_dup.md");
    const kg = join(tmpDir, "script_kg3.json");
    writeFileSync(transcript, "<!-- conversation_id: existing-id -->\n# Meeting");
    writeFileSync(
      kg,
      JSON.stringify({
        conversations: [{ conversation_id: "existing-id", time: "", main_topic: "", turns: [] }],
        topics: [],
        decisions: [],
      }, null, 2),
    );

    const result = runScript(transcript, kg);
    const output = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(output.status).toBe("ConversationAlreadyAdded");
    expect(output.conversation_id).toBe("existing-id");
  });

  test("exits with code 1 when transcript file does not exist", () => {
    const result = runScript("/nonexistent/transcript.md", "/some/kg.json");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("File not found");
  });
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});
