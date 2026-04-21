import { describe, test, expect } from "bun:test";
import { detectOverloadCount, normalizeRefs } from "./invocations.service.js";

describe("detectOverloadCount", () => {
  test("parses count from Serena ValueError", () => {
    const message =
      "Serena tool 'find_referencing_symbols' returned non-JSON response: " +
      "Error executing tool: ValueError - Found multiple 2 symbols matching " +
      "'ClientId/Equals'. They are: [...]";
    expect(detectOverloadCount(message)).toBe(2);
  });

  test("returns null when the message has no overload marker", () => {
    expect(detectOverloadCount("some unrelated error")).toBeNull();
  });

  test("returns null for zero count", () => {
    expect(
      detectOverloadCount("Found multiple 0 symbols matching 'Foo'"),
    ).toBeNull();
  });
});

describe("normalizeRefs", () => {
  test("passes through an array", () => {
    const refs = [{ name_path: "A/B", relative_path: "A.cs" }];
    expect(normalizeRefs(refs)).toEqual(refs);
  });

  test("unwraps references field", () => {
    const refs = [{ name_path: "A/B", relative_path: "A.cs" }];
    expect(normalizeRefs({ references: refs })).toEqual(refs);
  });

  test("unwraps results field", () => {
    const refs = [{ name_path: "A/B", relative_path: "A.cs" }];
    expect(normalizeRefs({ results: refs })).toEqual(refs);
  });

  test("unwraps symbols field", () => {
    const refs = [{ name_path: "A/B", relative_path: "A.cs" }];
    expect(normalizeRefs({ symbols: refs })).toEqual(refs);
  });

  test("treats null as empty", () => {
    expect(normalizeRefs(null)).toEqual([]);
  });

  test("treats undefined as empty", () => {
    expect(normalizeRefs(undefined)).toEqual([]);
  });

  test("flattens Serena file-grouped refs and injects relative_path from key", () => {
    const raw = {
      "A.cs": [{ name_path: "A/foo", kind: 12 }],
      "B.cs": [
        { name_path: "B/bar", kind: 12 },
        { name_path: "B/baz", kind: 12 },
      ],
    };
    expect(normalizeRefs(raw)).toEqual([
      { name_path: "A/foo", kind: 12, relative_path: "A.cs" },
      { name_path: "B/bar", kind: 12, relative_path: "B.cs" },
      { name_path: "B/baz", kind: 12, relative_path: "B.cs" },
    ]);
  });

  test("empty object maps to empty refs", () => {
    expect(normalizeRefs({})).toEqual([]);
  });

  test("keeps per-entry relative_path when present", () => {
    const raw = {
      "A.cs": [
        { name_path: "A/foo", kind: 12, relative_path: "override.cs" },
      ],
    };
    expect(normalizeRefs(raw)).toEqual([
      { name_path: "A/foo", kind: 12, relative_path: "override.cs" },
    ]);
  });

  test("returns null when file-grouped values contain primitives", () => {
    expect(normalizeRefs({ "A.cs": [42] })).toBeNull();
    expect(normalizeRefs({ "A.cs": true })).toBeNull();
  });

  test("returns null for primitive top-level values", () => {
    expect(normalizeRefs("string")).toBeNull();
    expect(normalizeRefs(42)).toBeNull();
    expect(normalizeRefs(true)).toBeNull();
  });

  test("flattens Serena's nested grouping by file then kind", () => {
    const raw = {
      "A.cs": {
        "12": [
          { name_path: "A/foo", content_around_reference: "ctx-a-foo" },
          { name_path: "A/bar", content_around_reference: "ctx-a-bar" },
        ],
      },
      "B.cs": {
        "12": [{ name_path: "B/baz", content_around_reference: "ctx-b-baz" }],
      },
    };
    expect(normalizeRefs(raw)).toEqual([
      {
        name_path: "A/foo",
        content_around_reference: "ctx-a-foo",
        relative_path: "A.cs",
      },
      {
        name_path: "A/bar",
        content_around_reference: "ctx-a-bar",
        relative_path: "A.cs",
      },
      {
        name_path: "B/baz",
        content_around_reference: "ctx-b-baz",
        relative_path: "B.cs",
      },
    ]);
  });

  test("treats collapsed string leaves as name_path only", () => {
    expect(normalizeRefs({ "A.cs": "A/foo" })).toEqual([
      { name_path: "A/foo", relative_path: "A.cs" },
    ]);
  });
});
