import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
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
  test("generates id, leaves source untouched, writes output.json with raw content", () => {
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
    });

    expect(result.status).toBe("Ok");
    expect(result.working_dir).toBe(
      join(tmpDir, "noesis:analyze-design-draft", result.document_id),
    );
    expect(existsSync(result.output_path)).toBe(true);
    expect(existsSync(result.section_tree_path)).toBe(true);
    expect(result.num_fragments).toBeGreaterThan(0);
    expect(result.design_doc_title).toBe("auth-system");
    expect(existsSync(join(tmpDir, "spec-cleaned.md"))).toBe(false);
    expect(readFileSync(docPath, "utf-8")).toBe(sourceContent);

    const output = JSON.parse(readFileSync(result.output_path, "utf-8"));
    expect(output.document.id).toBe(result.document_id);
    expect(output.document.title).toBe("Spec");
    expect(output.document.content).toBe(sourceContent);
    expect(output.fragments.length).toBe(result.num_fragments);
    expect(output.topics).toEqual([]);
    expect(output.potential_topics).toEqual({ topics: [] });
    expect(output.design_doc_title).toBe("auth-system");
  });

  test("reuses document_id from a manually stamped source file", () => {
    const docPath = join(tmpDir, "stamped.md");
    writeFileSync(docPath, "<!-- document_id: pinned-id -->\n# Stamped\n\nText.\n");
    const result = prepareDocument(docPath, "Stamped", "2026-04-25", {
      designDocId: null,
      designDocTitle: null,
      workingDirBase: tmpDir,
    });
    expect(result.document_id).toBe("pinned-id");
  });

  test("generates a fresh id on each run when source has no stamp", () => {
    const docPath = join(tmpDir, "rerun.md");
    writeFileSync(docPath, "# Rerun\n\nText.\n");
    const first = prepareDocument(docPath, "Rerun", "2026-04-25", {
      designDocId: null,
      designDocTitle: null,
      workingDirBase: tmpDir,
    });
    const second = prepareDocument(docPath, "Rerun", "2026-04-25", {
      designDocId: null,
      designDocTitle: null,
      workingDirBase: tmpDir,
    });
    expect(first.document_id).not.toBe(second.document_id);
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
