import { describe, test, expect } from "bun:test";
import { and, given, then, when } from "@tests/bdd.js";
import {
  detectOverloadCount,
  normalizeRefs,
} from "@noesis/mcp/noesis-graph/scanner/invocations/invocations.service.js";

describe("InvocationsService — interpreting Serena reference responses", () => {
  test("recognises Serena's overload-ambiguity error and extracts the count", async () => {
    let parsed: number | null = null;

    await given(
      "the wrapped error message Serena returns when several symbols match a name",
      () => {},
    );
    await when("the message is passed through detectOverloadCount", () => {
      const message =
        "Serena tool 'find_referencing_symbols' returned non-JSON response: " +
        "Error executing tool: ValueError - Found multiple 2 symbols matching " +
        "'ClientId/Equals'. They are: [...]";
      parsed = detectOverloadCount(message);
    });
    await then("the function reports the overload arity for the disambiguation loop", () => {
      expect(parsed).toBe(2);
    });
  });

  test("an unrelated error message reports no overload arity", async () => {
    let parsed: number | null = null;

    await given("an arbitrary unrelated Serena error", () => {});
    await when("the message is checked for an overload signature", () => {
      parsed = detectOverloadCount("some unrelated error");
    });
    await then("the function returns null so callers fall back to default handling", () => {
      expect(parsed).toBeNull();
    });
  });

  test("a zero-arity overload count is treated as no overload signature", async () => {
    let parsed: number | null = null;

    await given("an overload-shaped message that names zero matching symbols", () => {});
    await when("the message is checked for an overload count", () => {
      parsed = detectOverloadCount("Found multiple 0 symbols matching 'Foo'");
    });
    await then("the function returns null because zero is not a useful loop bound", () => {
      expect(parsed).toBeNull();
    });
  });

  test("a flat array of references is returned as-is for the caller", async () => {
    let result: ReturnType<typeof normalizeRefs>;

    await given("a Serena response that is already a flat array of references", () => {});
    await when("the response is normalised", () => {
      result = normalizeRefs([{ name_path: "A/B", relative_path: "A.cs" }]);
    });
    await then("the output is the same flat array of references", () => {
      expect(result).toEqual([{ name_path: "A/B", relative_path: "A.cs" }]);
    });
  });

  test("nullish responses are normalised to an empty reference list", async () => {
    let fromNull: ReturnType<typeof normalizeRefs>;
    let fromUndefined: ReturnType<typeof normalizeRefs>;

    await given("a Serena response that is null or absent", () => {});
    await when("each response is passed through normalizeRefs", () => {
      fromNull = normalizeRefs(null);
      fromUndefined = normalizeRefs(undefined);
    });
    await then("both produce an empty array so callers can iterate safely", () => {
      expect(fromNull).toEqual([]);
      expect(fromUndefined).toEqual([]);
    });
  });

  test("references nested under a known field name are unwrapped", async () => {
    const refs = [{ name_path: "A/B", relative_path: "A.cs" }];

    await given("Serena responses keyed under 'references', 'results', or 'symbols'", () => {});
    await when("each shape is normalised", () => {});
    await then("the wrapping field is stripped to expose the array", () => {
      expect(normalizeRefs({ references: refs })).toEqual(refs);
      expect(normalizeRefs({ results: refs })).toEqual(refs);
      expect(normalizeRefs({ symbols: refs })).toEqual(refs);
    });
  });

  test("a file-grouped response is flattened with file paths injected per entry", async () => {
    let result: ReturnType<typeof normalizeRefs>;

    await given(
      "a Serena response that groups references by file path with bare entries",
      () => {},
    );
    await when("the grouped response is normalised", () => {
      result = normalizeRefs({
        "A.cs": [{ name_path: "A/foo", kind: 12 }],
        "B.cs": [
          { name_path: "B/bar", kind: 12 },
          { name_path: "B/baz", kind: 12 },
        ],
      });
    });
    await then(
      "every entry carries its originating file path as relative_path",
      () => {
        expect(result).toEqual([
          { name_path: "A/foo", kind: 12, relative_path: "A.cs" },
          { name_path: "B/bar", kind: 12, relative_path: "B.cs" },
          { name_path: "B/baz", kind: 12, relative_path: "B.cs" },
        ]);
      },
    );
  });

  test("an entry that already has a relative_path keeps its own value", async () => {
    let result: ReturnType<typeof normalizeRefs>;

    await given(
      "a file-grouped response where one entry overrides relative_path",
      () => {},
    );
    await when("the response is normalised", () => {
      result = normalizeRefs({
        "A.cs": [
          { name_path: "A/foo", kind: 12, relative_path: "override.cs" },
        ],
      });
    });
    await then("the explicit relative_path wins over the grouping key", () => {
      expect(result).toEqual([
        { name_path: "A/foo", kind: 12, relative_path: "override.cs" },
      ]);
    });
  });

  test("a doubly-nested file-then-kind grouping is also flattened", async () => {
    let result: ReturnType<typeof normalizeRefs>;

    await given(
      "a Serena response grouped by file path and then by kind code",
      () => {},
    );
    await when("the doubly-nested response is normalised", () => {
      result = normalizeRefs({
        "A.cs": {
          "12": [{ name_path: "A/foo", content_around_reference: "ctx-a-foo" }],
        },
        "B.cs": {
          "12": [{ name_path: "B/baz", content_around_reference: "ctx-b-baz" }],
        },
      });
    });
    await then("the leaves are emitted with file paths attached", () => {
      expect(result).toEqual([
        {
          name_path: "A/foo",
          content_around_reference: "ctx-a-foo",
          relative_path: "A.cs",
        },
        {
          name_path: "B/baz",
          content_around_reference: "ctx-b-baz",
          relative_path: "B.cs",
        },
      ]);
    });
  });

  test("a string leaf inside a file group is upgraded to a name_path-only entry", async () => {
    let result: ReturnType<typeof normalizeRefs>;

    await given(
      "a collapsed file group whose value is a single name_path string",
      () => {},
    );
    await when("the response is normalised", () => {
      result = normalizeRefs({ "A.cs": "A/foo" });
    });
    await then(
      "the string is lifted into a reference entry tied to the file",
      () => {
        expect(result).toEqual([
          { name_path: "A/foo", relative_path: "A.cs" },
        ]);
      },
    );
  });

  test("primitive-valued top-level responses cannot be normalised", async () => {
    await given("a Serena response that is a string, number, or boolean", () => {});
    await when("the primitive is passed to normalizeRefs", () => {});
    await then("the function reports null so the caller can warn and skip", () => {
      expect(normalizeRefs("string")).toBeNull();
      expect(normalizeRefs(42)).toBeNull();
      expect(normalizeRefs(true)).toBeNull();
    });
  });

  test("file-grouped responses containing non-object leaves are rejected", async () => {
    await given(
      "a file-grouped response where the per-file value is a primitive list",
      () => {},
    );
    await when("the response is normalised", () => {});
    await and("an unsupported leaf type is encountered", () => {});
    await then("the function returns null instead of fabricating entries", () => {
      expect(normalizeRefs({ "A.cs": [42] })).toBeNull();
      expect(normalizeRefs({ "A.cs": true })).toBeNull();
    });
  });
});
