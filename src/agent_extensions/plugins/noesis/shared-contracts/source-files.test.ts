import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { z } from "zod";
import {
  computeContentSha,
  computeFileSha,
  conversationJsonPath,
  decisionJsonPath,
  designDocCanonicalFilename,
  designDocCanonicalPath,
  discoverSourceFiles,
  documentJsonPath,
  isUnderNoesisRoot,
  noesisRoot,
  noesisSubdirPath,
  readSidecar,
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

  test("entity-specific path helpers use {slug}-{id-suffix}.json in their kind subdir", () => {
    const proj = join(tmpRoot, "path-helpers");
    const id = "019ddea6-262b-7000-a160-f38c6b4cb4b7";
    expect(conversationJsonPath(proj, id, "Pricing review meeting")).toBe(
      resolve(proj, "noesis/conversations/pricing-review-meeting-6b4cb4b7.json"),
    );
    expect(documentJsonPath(proj, id, "Onboarding spec draft")).toBe(
      resolve(proj, "noesis/documents/onboarding-spec-draft-6b4cb4b7.json"),
    );
    expect(topicJsonPath(proj, id, "Sales pipeline metrics")).toBe(
      resolve(proj, "noesis/topics/sales-pipeline-metrics-6b4cb4b7.json"),
    );
    expect(decisionJsonPath(proj, id, "Adopt Postgres for ledger")).toBe(
      resolve(proj, "noesis/decisions/adopt-postgres-for-ledger-6b4cb4b7.json"),
    );
  });

  test("isUnderNoesisRoot recognises canonical paths", () => {
    expect(isUnderNoesisRoot("/proj", "/proj/noesis/conversations/x.json")).toBe(
      true,
    );
    expect(isUnderNoesisRoot("/proj", "/proj/other/x.json")).toBe(false);
  });
});

describe("discoverSourceFiles", () => {
  test("returns only .json sidecars and ignores stray .md files in noesis subdirs", () => {
    const proj = join(tmpRoot, "discover");
    const conversationsDir = noesisSubdirPath(proj, "conversation");
    mkdirSync(conversationsDir, { recursive: true });
    const json = join(conversationsDir, "x-12345678.json");
    const md = join(conversationsDir, "stray.md");
    writeFileSync(json, "{}", "utf-8");
    writeFileSync(md, "ignored", "utf-8");
    const found = discoverSourceFiles(proj).map((d) => d.path);
    expect(found).toContain(json);
    expect(found).not.toContain(md);
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
  test("uses <slug>-<id-suffix>.json with 30-char slug and 8-char hex suffix", () => {
    const proj = join(tmpRoot, "ddc-empty");
    const id = "019ddea6-262b-7000-a160-f38c6b4cb4b7";
    expect(designDocCanonicalFilename(proj, id, "footprint-calculation-engine")).toBe(
      "footprint-calculation-engine-6b4cb4b7.json",
    );
  });

  test("falls back to id suffix when slug is empty", () => {
    const proj = join(tmpRoot, "ddc-empty-slug");
    const id = "019ddea6-262b-7000-a160-f38c6b4cb4b7";
    expect(designDocCanonicalFilename(proj, id, "!!!")).toBe("6b4cb4b7.json");
  });

  test("extends the id suffix when another doc shares the 8-char tail", () => {
    const proj = join(tmpRoot, "ddc-collide");
    const dir = noesisSubdirPath(proj, "design_doc");
    mkdirSync(dir, { recursive: true });
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
    const id = "019ddea6-262b-7000-a160-f38c6b4cb4b7";
    expect(designDocCanonicalPath(proj, id, "auth")).toBe(
      resolve(proj, "noesis/design-docs/auth-6b4cb4b7.json"),
    );
  });
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});
