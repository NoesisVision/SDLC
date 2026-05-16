import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { prepareDocument } from "./prepare.js";

const tmpDir = mkdtempSync(join(import.meta.dirname, ".tmp-prepare-doc-"));
const SCRIPT = join(import.meta.dirname, "prepare.ts");

function runScript(...args: string[]) {
  const result = Bun.spawnSync(["bun", "run", SCRIPT, ...args]);
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("prepareDocument", () => {
  test("hashes the source content, returns the original path, never copies md into noesis", () => {
    const docPath = join(tmpDir, "spec.md");
    const sourceContent = `# Spec

## Section A

First paragraph here.

Second paragraph here.

## Section B

Another paragraph.
`;
    writeFileSync(docPath, sourceContent);

    const result = prepareDocument(docPath, "", "2026-04-25", {
      designDocId: null,
      designDocTitle: "auth-system",
      workingDirBase: tmpDir,
      projectDir: tmpDir,
    });

    expect(result.status).toBe("Ok");
    expect(result.document_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(result.working_dir).toBe(
      join(tmpDir, "noesis:analyze-design-draft", result.document_id),
    );
    expect(existsSync(result.output_path)).toBe(true);
    expect(existsSync(result.section_tree_path)).toBe(true);
    expect(result.source_path).toBe(docPath);
    expect(result.num_fragments).toBeGreaterThan(0);
    expect(result.design_doc_title).toBe("auth-system");

    // Original file is untouched.
    expect(readFileSync(docPath, "utf-8")).toBe(sourceContent);

    // No md was written under noesis/.
    const noesisDir = join(tmpDir, "noesis");
    if (existsSync(noesisDir)) {
      const found = readdirSync(noesisDir, { recursive: true }) as string[];
      expect(found.filter((p) => p.endsWith(".md"))).toEqual([]);
    }

    const output = JSON.parse(readFileSync(result.output_path, "utf-8"));
    expect(output.document.document_id).toBe(result.document_id);
    expect(output.document.title).toBe("Spec");
    expect(output.document.content).toBe(sourceContent);
    expect(output.document.fragments.length).toBe(result.num_fragments);
    expect(output.topics).toEqual([]);
    expect(output.design_doc_title).toBe("auth-system");
  });

  test("identical source content produces the same content-hash id across runs", () => {
    const docPath = join(tmpDir, "rerun.md");
    writeFileSync(docPath, "# Rerun\n\nText.\n");
    const first = prepareDocument(docPath, "Rerun", "2026-04-25", {
      designDocId: null,
      designDocTitle: null,
      workingDirBase: tmpDir,
      projectDir: tmpDir,
    });
    const second = prepareDocument(docPath, "Rerun", "2026-04-25", {
      designDocId: null,
      designDocTitle: null,
      workingDirBase: tmpDir,
      projectDir: tmpDir,
    });
    expect(first.document_id).toBe(second.document_id);
  });

  test("different source bytes produce different ids", () => {
    const a = join(tmpDir, "a.md");
    const b = join(tmpDir, "b.md");
    writeFileSync(a, "# A\n\nAlpha.\n");
    writeFileSync(b, "# B\n\nBeta.\n");
    const ra = prepareDocument(a, "A", "2026-04-25", {
      designDocId: null,
      designDocTitle: null,
      workingDirBase: tmpDir,
      projectDir: tmpDir,
    });
    const rb = prepareDocument(b, "B", "2026-04-25", {
      designDocId: null,
      designDocTitle: null,
      workingDirBase: tmpDir,
      projectDir: tmpDir,
    });
    expect(ra.document_id).not.toBe(rb.document_id);
  });
});

describe("prepare_document script", () => {
  test("exits with code 1 when document file does not exist", () => {
    const result = runScript("/nonexistent/file.md", "Title", "2026-04-25");
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
