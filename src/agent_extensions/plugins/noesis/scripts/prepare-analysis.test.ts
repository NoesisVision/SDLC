import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { generateChunks, initConversation, prepareAnalysis } from "./prepare-analysis.js";
import type { RawTurn } from "./transcript/types.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `prepare_analysis_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeTurns(count: number): RawTurn[] {
  return Array.from({ length: count }, (_, i) => ({
    speaker: `Speaker ${i}`,
    time: `00:0${i}:00`,
    sentences: [`Sentence ${i} about topic.`, `Another sentence ${i}.`],
  }));
}

describe("initConversation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates conversation.json with metadata and empty arrays", () => {
    const path = initConversation(tmpDir, "conv-123", "2026-01-15 10:00:00", "Architecture review");

    expect(path).toBe(join(tmpDir, "conversation.json"));
    expect(existsSync(path)).toBe(true);

    const data = JSON.parse(readFileSync(path, "utf-8"));
    expect(data.conversation_id).toBe("conv-123");
    expect(data.time).toBe("2026-01-15 10:00:00");
    expect(data.main_topic).toBe("Architecture review");
    expect(data.turns).toEqual([]);
    expect(data.topics).toEqual([]);
    expect(data.decisions).toEqual([]);
  });
});

describe("generateChunks", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns empty array for no turns", () => {
    const chunks = generateChunks([], tmpDir, 8000);
    expect(chunks).toEqual([]);
  });

  test("creates single chunk when all turns fit within limit", () => {
    const turns = makeTurns(3);
    const chunks = generateChunks(turns, tmpDir, 8000);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunk_id).toBe(0);
    expect(chunks[0].num_turns).toBe(3);
    expect(chunks[0].file).toBe(join(tmpDir, "chunk_0.md"));

    const content = readFileSync(chunks[0].file, "utf-8");
    expect(content).toContain("### [0]");
    expect(content).toContain("### [1]");
    expect(content).toContain("### [2]");
  });

  test("creates multiple chunks when turns exceed limit", () => {
    const turns = makeTurns(10);
    // Very small token limit to force multiple chunks
    const chunks = generateChunks(turns, tmpDir, 10);

    expect(chunks.length).toBeGreaterThan(1);

    // Verify all turns are accounted for
    let totalTurns = 0;
    for (const chunk of chunks) {
      totalTurns += chunk.num_turns;
      expect(existsSync(chunk.file)).toBe(true);
    }
    expect(totalTurns).toBe(10);

    // Verify sequential chunk IDs
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].chunk_id).toBe(i);
    }
  });

  test("each chunk file contains turns with correct indices", () => {
    const turns = makeTurns(6);
    const chunks = generateChunks(turns, tmpDir, 20);

    let expectedIndex = 0;
    for (const chunk of chunks) {
      const content = readFileSync(chunk.file, "utf-8");
      for (let i = 0; i < chunk.num_turns; i++) {
        expect(content).toContain(`### [${expectedIndex}]`);
        expectedIndex++;
      }
    }
    expect(expectedIndex).toBe(6);
  });

  test("always includes at least one turn per chunk even if it exceeds limit", () => {
    const turns: RawTurn[] = [
      { speaker: "A", time: "00:00:00", sentences: ["x".repeat(200)] },
      { speaker: "B", time: "00:01:00", sentences: ["y".repeat(200)] },
    ];
    // Token limit of 1 is impossibly small
    const chunks = generateChunks(turns, tmpDir, 1);

    // Each turn should still get its own chunk
    expect(chunks.length).toBe(2);
    expect(chunks[0].num_turns).toBe(1);
    expect(chunks[1].num_turns).toBe(1);
  });

  test("chunk files contain speaker, time, and sentences in markdown", () => {
    const turns = makeTurns(2);
    const chunks = generateChunks(turns, tmpDir, 8000);
    const content = readFileSync(chunks[0].file, "utf-8");

    expect(content).toContain("### [0] 00:00:00 — Speaker 0");
    expect(content).toContain("- Sentence 0 about topic.");
    expect(content).toContain("- Another sentence 0.");
  });
});

describe("prepareAnalysis", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns ConversationAlreadyAdded when ID exists in knowledge graph", async () => {
    const transcriptPath = join(tmpDir, "meeting.md");
    const kgPath = join(tmpDir, "kg.json");

    writeFileSync(
      transcriptPath,
      '<!-- conversation_id: existing-id -->\n**00:01**\nAlice\nHello world.\n',
      "utf-8",
    );
    writeFileSync(
      kgPath,
      JSON.stringify({
        conversations: [{ conversation_id: "existing-id", time: "2026-01-01 10:00:00", main_topic: "Test", turns: [] }],
        topics: [],
        decisions: [],
      }, null, 2),
      "utf-8",
    );

    const result = await prepareAnalysis(
      transcriptPath,
      kgPath,
      "2026-01-15 10:00:00",
      "Test topic",
    );

    expect(result.status).toBe("ConversationAlreadyAdded");
    expect(result.conversation_id).toBe("existing-id");
    expect(result.chunks).toBeUndefined();
    expect(result.structured_transcript_path).toBeUndefined();
  });

  test("full pipeline: generates working dir, transcript, conversation, and chunks", async () => {
    const transcriptPath = join(tmpDir, "meeting.md");
    const kgPath = join(tmpDir, "kg.json");

    writeFileSync(
      transcriptPath,
      [
        "**00:01**",
        "Alice",
        "First point about the architecture. This is important.",
        "",
        "**00:02**",
        "Bob",
        "I agree with the approach. Let me add some details.",
        "",
        "**00:03**",
        "Alice",
        "Good point. We should also consider performance.",
        "",
      ].join("\n"),
      "utf-8",
    );

    const result = await prepareAnalysis(
      transcriptPath,
      kgPath,
      "2026-01-15 10:00:00",
      "Architecture discussion",
    );

    expect(result.status).toBe("Ok");
    expect(result.working_dir).toContain("meeting_work");
    expect(result.conversation_id).toBeTruthy();
    expect(result.chunks).toBeDefined();
    expect(result.chunks!.length).toBeGreaterThan(0);
    expect(result.structured_transcript_path).toBeDefined();

    // Verify conversation.json was created
    const convPath = join(result.working_dir, "conversation.json");
    expect(existsSync(convPath)).toBe(true);
    const conv = JSON.parse(readFileSync(convPath, "utf-8"));
    expect(conv.conversation_id).toBe(result.conversation_id);
    expect(conv.time).toBe("2026-01-15 10:00:00");
    expect(conv.main_topic).toBe("Architecture discussion");

    // Verify chunks were written as markdown
    for (const chunk of result.chunks!) {
      expect(existsSync(chunk.file)).toBe(true);
      expect(chunk.file).toEndWith(".md");
    }

    // Verify total turns across chunks equals transcript turns
    const totalTurns = result.chunks!.reduce((sum, c) => sum + c.num_turns, 0);
    expect(totalTurns).toBe(3);

    // Cleanup generated working dir
    rmSync(result.working_dir, { recursive: true, force: true });
  });

  test("generates conversation ID when transcript has none", async () => {
    const transcriptPath = join(tmpDir, "no_id.md");
    const kgPath = join(tmpDir, "kg.json");

    writeFileSync(
      transcriptPath,
      "**00:01**\nAlice\nHello there. How are you?\n",
      "utf-8",
    );

    const result = await prepareAnalysis(
      transcriptPath,
      kgPath,
      "2026-01-15 10:00:00",
      "Greeting",
    );

    expect(result.status).toBe("Ok");
    expect(result.conversation_id).toBeTruthy();

    // Verify ID was prepended to transcript
    const content = readFileSync(transcriptPath, "utf-8");
    expect(content.startsWith("<!-- conversation_id:")).toBe(true);

    rmSync(result.working_dir, { recursive: true, force: true });
  });
});
