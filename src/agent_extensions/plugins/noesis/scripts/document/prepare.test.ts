import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  buildCleanedMarkdown,
  getCleanedPath,
  prepareDocument,
} from "./prepare.js";

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

describe("getCleanedPath", () => {
  test("appends -cleaned.md and replaces extension", () => {
    expect(getCleanedPath("/foo/bar/spec.md")).toBe(
      "/foo/bar/spec-cleaned.md",
    );
  });
});

describe("buildCleanedMarkdown", () => {
  test("stamps document_id at top when missing", () => {
    const result = buildCleanedMarkdown("doc-1", "# Title\nBody");
    expect(result.split("\n")[0]).toBe("<!-- document_id: doc-1 -->");
    expect(result).toContain("# Title");
  });

  test("replaces existing document_id line", () => {
    const original = "<!-- document_id: old -->\n# Title\nBody";
    const result = buildCleanedMarkdown("new", original);
    expect(result.split("\n")[0]).toBe("<!-- document_id: new -->");
    expect(result).not.toContain("old");
  });
});

describe("prepareDocument", () => {
  test("generates id, writes cleaned doc and output.json", () => {
    const docPath = join(tmpDir, "spec.md");
    writeFileSync(
      docPath,
      `# Spec

## Section A

First paragraph here.

Second paragraph here.

## Section B

Another paragraph.
`,
    );

    const result = prepareDocument(docPath, "", "2026-04-25", {
      designDocId: null,
      designDocTitle: "auth-system",
    });

    expect(result.status).toBe("Ok");
    expect(result.cleaned_path).toBe(join(tmpDir, "spec-cleaned.md"));
    expect(existsSync(result.cleaned_path)).toBe(true);
    expect(result.working_dir).toContain("noesis-doc-");
    expect(existsSync(result.output_path)).toBe(true);
    expect(existsSync(result.section_tree_path)).toBe(true);
    expect(result.num_fragments).toBeGreaterThan(0);
    expect(result.design_doc_title).toBe("auth-system");

    const cleaned = readFileSync(result.cleaned_path, "utf-8");
    expect(cleaned.split("\n")[0]).toBe(
      `<!-- document_id: ${result.document_id} -->`,
    );

    const output = JSON.parse(readFileSync(result.output_path, "utf-8"));
    expect(output.document.id).toBe(result.document_id);
    expect(output.document.title).toBe("Spec");
    expect(output.document.content).toBe(cleaned);
    expect(output.fragments.length).toBe(result.num_fragments);
    expect(output.topics).toEqual([]);
    expect(output.potential_topics).toEqual({ topics: [] });
    expect(output.design_doc_title).toBe("auth-system");
  });

  test("reuses document_id from cleaned file on rerun", () => {
    const docPath = join(tmpDir, "rerun.md");
    writeFileSync(docPath, "# Rerun\n\nText.\n");
    const first = prepareDocument(docPath, "Rerun", "2026-04-25", {
      designDocId: null,
      designDocTitle: null,
    });
    const second = prepareDocument(docPath, "Rerun", "2026-04-25", {
      designDocId: null,
      designDocTitle: null,
    });
    expect(second.document_id).toBe(first.document_id);
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
