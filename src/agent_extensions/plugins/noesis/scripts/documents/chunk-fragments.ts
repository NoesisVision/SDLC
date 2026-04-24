import { join } from "path";
import { writeFileSync } from "fs";
import type { DocumentFragment } from "../../shared-contracts/document-analysis.js";

const CHARS_PER_TOKEN = 4;
const OVERLAP_FRAGMENTS = 1;

export interface ChunkInfo {
  chunk_id: number;
  file: string;
  fragment_indices: number[];
  num_fragments: number;
  section_paths: string[][];
}

export function chunkFragments(
  fragments: DocumentFragment[],
  workingDir: string,
  tokenLimit: number,
): ChunkInfo[] {
  if (fragments.length === 0) return [];

  const charLimit = tokenLimit * CHARS_PER_TOKEN;
  const totalChars = fragments.reduce((sum, f) => sum + estimateChars(f), 0);
  const expectedParts = Math.max(1, Math.ceil(totalChars / charLimit));
  const targetChars = Math.ceil((totalChars / expectedParts + charLimit) / 2);

  const chunks: ChunkInfo[] = [];
  let startIndex = 0;
  let chunkId = 0;

  while (startIndex < fragments.length) {
    let charCount = 0;
    let consumed = 0;

    while (startIndex + consumed < fragments.length) {
      const f = fragments[startIndex + consumed];
      const fragmentChars = estimateChars(f);
      if (consumed > 0 && charCount + fragmentChars > targetChars) break;
      charCount += fragmentChars;
      consumed++;
    }

    const slice = fragments.slice(startIndex, startIndex + consumed);
    const filePath = join(workingDir, `chunk_${chunkId}.md`);
    writeFileSync(filePath, formatChunkMarkdown(slice), "utf-8");

    chunks.push({
      chunk_id: chunkId,
      file: filePath,
      fragment_indices: slice.map((f) => f.index),
      num_fragments: slice.length,
      section_paths: distinctSectionPaths(slice),
    });

    chunkId++;
    const reachedEnd = startIndex + consumed >= fragments.length;
    if (reachedEnd) break;
    startIndex = Math.max(startIndex + 1, startIndex + consumed - OVERLAP_FRAGMENTS);
  }

  return chunks;
}

export function formatChunkMarkdown(fragments: DocumentFragment[]): string {
  const lines: string[] = [];
  let lastSectionPath: string | null = null;
  for (const f of fragments) {
    const sectionPath = f.section_path.length > 0 ? f.section_path.join(" / ") : "(no section)";
    if (sectionPath !== lastSectionPath) {
      lines.push(`## Section: ${sectionPath}`);
      lines.push("");
      lastSectionPath = sectionPath;
    }
    lines.push(`### [F${f.index}] ${f.kind} _(offsets ${f.start_offset}-${f.end_offset})_`);
    lines.push(f.text);
    lines.push("");
  }
  return lines.join("\n");
}

// --- Private functions ---

function distinctSectionPaths(fragments: DocumentFragment[]): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const f of fragments) {
    const key = f.section_path.join("\u0001");
    if (!seen.has(key)) {
      seen.add(key);
      out.push(f.section_path);
    }
  }
  return out;
}

function estimateChars(fragment: DocumentFragment): number {
  return fragment.text.length + fragment.section_path.join(" / ").length + 32;
}
