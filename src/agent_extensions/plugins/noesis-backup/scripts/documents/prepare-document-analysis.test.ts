import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { prepareDocumentAnalysis } from "./prepare-document-analysis.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "prep_doc_test_"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("prepareDocumentAnalysis", () => {
  test("creates working dir, document.json, analysis.json, section_tree.md, and chunks", () => {
    const docPath = join(tmpDir, "draft.md");
    writeFileSync(
      docPath,
      [
        "# Top",
        "",
        "Intro paragraph.",
        "",
        "## Sub",
        "",
        "Sub body.",
      ].join("\n"),
      "utf-8",
    );

    const result = prepareDocumentAnalysis(docPath, "Draft", "2026-04-24", {
      designDocId: null,
      designDocTitle: "auth-system",
    });

    expect(result.status).toBe("Ok");
    expect(existsSync(result.working_dir)).toBe(true);
    expect(existsSync(result.document_path)).toBe(true);
    expect(existsSync(result.analysis_path)).toBe(true);
    expect(existsSync(result.section_tree_path)).toBe(true);
    expect(result.design_doc_title).toBe("auth-system");
    expect(result.design_doc_id).toBeNull();

    const document = JSON.parse(readFileSync(result.document_path, "utf-8"));
    expect(document.id).toBe(result.document_id);
    expect(document.title).toBe("Draft");
    expect(document.date).toBe("2026-04-24");
    expect(document.content).toContain("# Top");

    const analysis = JSON.parse(readFileSync(result.analysis_path, "utf-8"));
    expect(analysis.document_id).toBe(result.document_id);
    expect(analysis.fragments.length).toBeGreaterThan(0);
    expect(analysis.section_tree.length).toBeGreaterThan(0);
    expect(analysis.topics).toEqual([]);
    expect(analysis.decision_attachments).toEqual([]);
    expect(analysis.design_doc_extracted).toBe(false);

    expect(result.chunks.length).toBeGreaterThan(0);
    for (const chunk of result.chunks) {
      expect(existsSync(chunk.file)).toBe(true);
    }
  });

  test("monologue (no headings) still produces fragments and chunks", () => {
    const docPath = join(tmpDir, "mono.md");
    writeFileSync(docPath, "First paragraph.\n\nSecond paragraph.\n", "utf-8");

    const result = prepareDocumentAnalysis(docPath, "", "2026-04-24", {
      designDocId: null,
      designDocTitle: null,
    });

    expect(result.status).toBe("Ok");
    const analysis = JSON.parse(readFileSync(result.analysis_path, "utf-8"));
    expect(analysis.section_tree).toEqual([]);
    expect(analysis.fragments).toHaveLength(2);
    expect(result.chunks.length).toBe(1);
  });

  test("derives title from first H1 when title is empty", () => {
    const docPath = join(tmpDir, "no_title.md");
    writeFileSync(docPath, "# Real title\n\nBody.\n", "utf-8");

    const result = prepareDocumentAnalysis(docPath, "", "2026-04-24", {
      designDocId: null,
      designDocTitle: null,
    });

    const document = JSON.parse(readFileSync(result.document_path, "utf-8"));
    expect(document.title).toBe("Real title");
  });

  test("falls back to filename when no H1 and empty title", () => {
    const docPath = join(tmpDir, "named-doc.md");
    writeFileSync(docPath, "Body without heading.\n", "utf-8");

    const result = prepareDocumentAnalysis(docPath, "", "2026-04-24", {
      designDocId: null,
      designDocTitle: null,
    });

    const document = JSON.parse(readFileSync(result.document_path, "utf-8"));
    expect(document.title).toBe("named-doc");
  });

  test("generates document_id when none embedded", () => {
    const docPath = join(tmpDir, "no_id.md");
    writeFileSync(docPath, "# T\n\nBody.\n", "utf-8");

    const result = prepareDocumentAnalysis(docPath, "T", "2026-04-24", {
      designDocId: null,
      designDocTitle: null,
    });

    expect(result.document_id).toBeTruthy();
    const content = readFileSync(docPath, "utf-8");
    expect(content.startsWith("<!-- document_id:")).toBe(true);
  });

  test("reuses embedded document_id", () => {
    const docPath = join(tmpDir, "has_id.md");
    writeFileSync(docPath, "<!-- document_id: doc-123 -->\n# T\n\nBody.\n", "utf-8");

    const result = prepareDocumentAnalysis(docPath, "T", "2026-04-24", {
      designDocId: null,
      designDocTitle: null,
    });

    expect(result.document_id).toBe("doc-123");
  });

  test("fragment offsets reference document.json content", () => {
    const docPath = join(tmpDir, "offset.md");
    writeFileSync(docPath, "# T\n\nFirst.\n\nSecond.\n", "utf-8");

    const result = prepareDocumentAnalysis(docPath, "T", "2026-04-24", {
      designDocId: null,
      designDocTitle: null,
    });

    const document = JSON.parse(readFileSync(result.document_path, "utf-8"));
    const analysis = JSON.parse(readFileSync(result.analysis_path, "utf-8"));
    for (const fragment of analysis.fragments) {
      const slice = document.content.slice(fragment.start_offset, fragment.end_offset);
      expect(slice.trim()).toBe(fragment.text);
    }
  });

  test("script entry point parses arguments and writes JSON to stdout", async () => {
    const docPath = join(tmpDir, "cli.md");
    writeFileSync(docPath, "# Title\n\nBody.\n", "utf-8");

    const scriptPath = join(import.meta.dirname, "prepare-document-analysis.ts");
    const proc = Bun.spawnSync([
      "bun",
      "run",
      scriptPath,
      docPath,
      "Title",
      "2026-04-24",
      "--design_doc_title",
      "test-design",
    ]);

    expect(proc.exitCode).toBe(0);
    const output = JSON.parse(proc.stdout.toString());
    expect(output.status).toBe("Ok");
    expect(output.design_doc_title).toBe("test-design");
    expect(output.design_doc_id).toBeNull();
  });
});
