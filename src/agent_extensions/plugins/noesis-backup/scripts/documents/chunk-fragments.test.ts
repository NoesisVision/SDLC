import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { chunkFragments } from "./chunk-fragments.js";
import type { DocumentFragment } from "../../shared-contracts/document-analysis.js";

function makeFragment(
  index: number,
  textChars: number,
  section_path: string[] = ["S"],
): DocumentFragment {
  return {
    index,
    start_offset: index * 100,
    end_offset: index * 100 + textChars,
    section_path,
    kind: "paragraph",
    text: "x".repeat(textChars),
    categories: [],
  };
}

let workingDir: string;

beforeEach(() => {
  workingDir = mkdtempSync(join(tmpdir(), "chunk_test_"));
  mkdirSync(workingDir, { recursive: true });
});

afterEach(() => {
  rmSync(workingDir, { recursive: true, force: true });
});

describe("chunkFragments", () => {
  test("empty input returns empty chunks", () => {
    const chunks = chunkFragments([], workingDir, 100);
    expect(chunks).toEqual([]);
  });

  test("all fragments fit in one chunk when under limit", () => {
    const fragments = Array.from({ length: 5 }, (_, i) => makeFragment(i, 50));
    const chunks = chunkFragments(fragments, workingDir, 8000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].num_fragments).toBe(5);
    expect(chunks[0].fragment_indices).toEqual([0, 1, 2, 3, 4]);
  });

  test("splits into multiple chunks when over limit", () => {
    const fragments = Array.from({ length: 20 }, (_, i) => makeFragment(i, 200));
    const chunks = chunkFragments(fragments, workingDir, 200);
    expect(chunks.length).toBeGreaterThan(1);
    const indicesUnion = new Set<number>();
    for (const c of chunks) c.fragment_indices.forEach((i) => indicesUnion.add(i));
    for (let i = 0; i < 20; i++) expect(indicesUnion.has(i)).toBe(true);
  });

  test("consecutive multi-fragment chunks overlap by 1 fragment", () => {
    const fragments = Array.from({ length: 30 }, (_, i) => makeFragment(i, 100));
    const chunks = chunkFragments(fragments, workingDir, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1].fragment_indices;
      const curr = chunks[i].fragment_indices;
      if (prev.length > 1) {
        expect(curr[0]).toBe(prev[prev.length - 1]);
      }
    }
  });

  test("single-fragment chunks advance without duplication", () => {
    const fragments = Array.from({ length: 4 }, (_, i) => makeFragment(i, 5000));
    const chunks = chunkFragments(fragments, workingDir, 100);
    expect(chunks).toHaveLength(4);
    expect(chunks.map((c) => c.fragment_indices[0])).toEqual([0, 1, 2, 3]);
  });

  test("forces at least one fragment per chunk even when oversized", () => {
    const fragments = [makeFragment(0, 5000), makeFragment(1, 5000)];
    const chunks = chunkFragments(fragments, workingDir, 100);
    expect(chunks.length).toBe(2);
    expect(chunks[0].fragment_indices).toEqual([0]);
    expect(chunks[1].fragment_indices).toEqual([1]);
  });

  test("writes a chunk file with section header and fragment markers", () => {
    const fragments = [
      makeFragment(0, 30, ["A"]),
      makeFragment(1, 30, ["A", "B"]),
    ];
    const chunks = chunkFragments(fragments, workingDir, 8000);
    const content = readFileSync(chunks[0].file, "utf-8");
    expect(content).toContain("## Section: A");
    expect(content).toContain("## Section: A / B");
    expect(content).toContain("### [F0]");
    expect(content).toContain("### [F1]");
  });
});
