import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { z } from "zod";
import {
  computeContentSha,
  computeFileSha,
  conversationJsonPath,
  conversationMdPath,
  decisionJsonPath,
  designDocCanonicalFilename,
  designDocCanonicalPath,
  designDocJsonPath,
  documentJsonPath,
  documentMdPath,
  ensureNoesisLayout,
  extractIdFromMd,
  idLineComment,
  isUnderNoesisRoot,
  noesisRoot,
  noesisSubdirPath,
  readSidecar,
  stampIdLine,
  stripIdLine,
  topicJsonPath,
  writeSidecar,
} from "./source-files.js";

const tmpRoot = mkdtempSync(join(tmpdir(), "noesis-source-files-"));

describe("path helpers", () => {
  test("noesisRoot resolves to <projectDir>/noesis", () => {
    expect(noesisRoot("/proj")).toBe(resolve("/proj/noesis"));
  });

  test("noesisSubdirPath maps each kind to its directory name", () => {
    expect(noesisSubdirPath("/proj", "conversation")).toBe(
      resolve("/proj/noesis/conversations"),
    );
    expect(noesisSubdirPath("/proj", "document")).toBe(
      resolve("/proj/noesis/documents"),
    );
    expect(noesisSubdirPath("/proj", "topic")).toBe(
      resolve("/proj/noesis/topics"),
    );
    expect(noesisSubdirPath("/proj", "decision")).toBe(
      resolve("/proj/noesis/decisions"),
    );
    expect(noesisSubdirPath("/proj", "design_doc")).toBe(
      resolve("/proj/noesis/design-docs"),
    );
  });

  test("entity-specific path helpers compose root + subdir + filename", () => {
    expect(conversationMdPath("/p", "abc")).toBe(
      resolve("/p/noesis/conversations/abc.md"),
    );
    expect(conversationJsonPath("/p", "abc")).toBe(
      resolve("/p/noesis/conversations/abc.json"),
    );
    expect(documentMdPath("/p", "id")).toBe(
      resolve("/p/noesis/documents/id.md"),
    );
    expect(documentJsonPath("/p", "id")).toBe(
      resolve("/p/noesis/documents/id.json"),
    );
    expect(topicJsonPath("/p", "t1")).toBe(
      resolve("/p/noesis/topics/t1.json"),
    );
    expect(decisionJsonPath("/p", "d1")).toBe(
      resolve("/p/noesis/decisions/d1.json"),
    );
    expect(designDocJsonPath("/p", "dd1")).toBe(
      resolve("/p/noesis/design-docs/dd1.json"),
    );
  });

  test("isUnderNoesisRoot recognises canonical paths", () => {
    expect(isUnderNoesisRoot("/proj", "/proj/noesis/conversations/x.md")).toBe(
      true,
    );
    expect(isUnderNoesisRoot("/proj", "/proj/other/x.md")).toBe(false);
  });
});

describe("ID-line stamping", () => {
  test("idLineComment emits the canonical HTML comment for each kind", () => {
    expect(idLineComment("conversation", "abc")).toBe(
      "<!-- conversation_id: abc -->",
    );
    expect(idLineComment("document", "abc")).toBe(
      "<!-- document_id: abc -->",
    );
  });

  test("extractIdFromMd reads the id back when first line matches", () => {
    const md = "<!-- conversation_id: my-id -->\n# Hello\nbody";
    expect(extractIdFromMd(md, "conversation")).toBe("my-id");
  });

  test("extractIdFromMd returns null when no id line is present", () => {
    expect(extractIdFromMd("# Hello\nbody", "conversation")).toBeNull();
  });

  test("extractIdFromMd ignores id lines for other kinds", () => {
    const md = "<!-- document_id: doc-1 -->\nbody";
    expect(extractIdFromMd(md, "conversation")).toBeNull();
  });

  test("stampIdLine prepends id when missing", () => {
    expect(stampIdLine("# Title\n", "conversation", "abc")).toBe(
      "<!-- conversation_id: abc -->\n# Title\n",
    );
  });

  test("stampIdLine replaces an existing id line", () => {
    const stamped = stampIdLine(
      "<!-- conversation_id: old -->\n# Title\n",
      "conversation",
      "new",
    );
    expect(extractIdFromMd(stamped, "conversation")).toBe("new");
    expect(stamped).toBe("<!-- conversation_id: new -->\n# Title\n");
  });

  test("stripIdLine removes the leading id line if any", () => {
    expect(stripIdLine("<!-- conversation_id: a -->\nrest")).toBe("rest");
    expect(stripIdLine("rest")).toBe("rest");
  });

  test("stamping then extracting roundtrips for both .md kinds", () => {
    const stampedConvo = stampIdLine("body\n", "conversation", "c-1");
    const stampedDoc = stampIdLine("body\n", "document", "d-1");
    expect(extractIdFromMd(stampedConvo, "conversation")).toBe("c-1");
    expect(extractIdFromMd(stampedDoc, "document")).toBe("d-1");
  });
});

describe("sha helpers", () => {
  test("computeContentSha returns sha256 hex", () => {
    const sha = computeContentSha("hello");
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    expect(sha).toBe(computeContentSha("hello"));
    expect(sha).not.toBe(computeContentSha("hellp"));
  });

  test("computeFileSha matches computeContentSha for the same bytes", () => {
    const path = join(tmpRoot, "sha-roundtrip.txt");
    writeFileSync(path, "payload");
    expect(computeFileSha(path)).toBe(computeContentSha("payload"));
  });
});

describe("sidecar IO", () => {
  const Schema = z.object({
    id: z.string(),
    title: z.string(),
    items: z.array(z.string()).default(() => []),
  });

  test("writeSidecar creates the parent directory and persists JSON", () => {
    const path = join(tmpRoot, "sidecar/dir/file.json");
    writeSidecar(path, { id: "a", title: "t", items: ["x"] }, Schema);
    expect(existsSync(path)).toBe(true);
    const raw = readFileSync(path, "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw)).toEqual({ id: "a", title: "t", items: ["x"] });
  });

  test("readSidecar parses and validates the file", () => {
    const path = join(tmpRoot, "sidecar/read.json");
    writeSidecar(path, { id: "a", title: "t" }, Schema);
    const out = readSidecar(path, Schema);
    expect(out).toEqual({ id: "a", title: "t", items: [] });
  });

  test("writeSidecar refuses invalid input", () => {
    const path = join(tmpRoot, "sidecar/invalid.json");
    expect(() =>
      writeSidecar(path, { id: 1, title: "t" } as unknown as { id: string; title: string }, Schema),
    ).toThrow();
  });
});

describe("designDocCanonicalFilename", () => {
  test("uses <slug>-<id-suffix>.json with 20-char slug and 8-char hex suffix", () => {
    const proj = join(tmpRoot, "ddc-empty");
    ensureNoesisLayout(proj);
    const id = "019ddea6-262b-7000-a160-f38c6b4cb4b7";
    expect(designDocCanonicalFilename(proj, id, "footprint-calculation-engine")).toBe(
      "footprint-calculatio-6b4cb4b7.json",
    );
  });

  test("falls back to id suffix when slug is empty", () => {
    const proj = join(tmpRoot, "ddc-empty-slug");
    ensureNoesisLayout(proj);
    const id = "019ddea6-262b-7000-a160-f38c6b4cb4b7";
    expect(designDocCanonicalFilename(proj, id, "!!!")).toBe("6b4cb4b7.json");
  });

  test("extends the id suffix when another doc shares the 8-char tail", () => {
    const proj = join(tmpRoot, "ddc-collide");
    ensureNoesisLayout(proj);
    const dir = noesisSubdirPath(proj, "design_doc");
    writeFileSync(
      resolve(dir, "other-cccccccc.json"),
      JSON.stringify({ id: "0000-0000-0000-0000-aaaa6b4cb4b7", name: "other" }),
    );
    const id = "019ddea6-262b-7000-a160-f38c6b4cb4b7";
    const filename = designDocCanonicalFilename(proj, id, "name-x");
    expect(filename.endsWith(".json")).toBe(true);
    expect(filename).not.toBe("name-x-6b4cb4b7.json");
    expect(filename.startsWith("name-x-")).toBe(true);
  });

  test("designDocCanonicalPath joins the design-docs subdir", () => {
    const proj = join(tmpRoot, "ddc-path");
    ensureNoesisLayout(proj);
    const id = "019ddea6-262b-7000-a160-f38c6b4cb4b7";
    expect(designDocCanonicalPath(proj, id, "auth")).toBe(
      resolve(proj, "noesis/design-docs/auth-6b4cb4b7.json"),
    );
  });
});

describe("ensureNoesisLayout", () => {
  test("creates every subdirectory under <projectDir>/noesis", () => {
    const proj = join(tmpRoot, "layout-proj");
    ensureNoesisLayout(proj);
    expect(existsSync(noesisSubdirPath(proj, "conversation"))).toBe(true);
    expect(existsSync(noesisSubdirPath(proj, "document"))).toBe(true);
    expect(existsSync(noesisSubdirPath(proj, "topic"))).toBe(true);
    expect(existsSync(noesisSubdirPath(proj, "decision"))).toBe(true);
    expect(existsSync(noesisSubdirPath(proj, "design_doc"))).toBe(true);
  });
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});
