import { describe, expect, test } from "bun:test";
import {
  InputConfigSchema,
  AnalysisResultSchema,
  lspKindToTypeKind,
  LSP_KIND,
} from "./types.js";

describe("InputConfigSchema", () => {
  test("validates valid config", () => {
    const config = {
      serena: { command: "/usr/bin/serena", args: ["--project", "/app"] },
      attributes: ["ApiController"],
    };
    const result = InputConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  test("defaults args to empty array", () => {
    const config = {
      serena: { command: "/usr/bin/serena" },
      attributes: ["ApiController"],
    };
    const result = InputConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.serena.args).toEqual([]);
    }
  });

  test("rejects empty attributes", () => {
    const config = {
      serena: { command: "/usr/bin/serena" },
      attributes: [],
    };
    const result = InputConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  test("rejects missing command", () => {
    const config = {
      serena: { args: [] },
      attributes: ["Foo"],
    };
    const result = InputConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});

describe("AnalysisResultSchema", () => {
  test("validates complete result", () => {
    const result = {
      types: [
        {
          name: "OrdersController",
          fullyQualifiedName: "MyApp.Controllers.OrdersController",
          namespace: "MyApp.Controllers",
          kind: "class",
          filePath: "src/Controllers/OrdersController.cs",
          attributes: ["ApiController"],
          methods: [
            {
              name: "GetOrder",
              returnType: "Task<ActionResult<OrderDto>>",
              parameters: [{ name: "id", type: "int" }],
            },
          ],
          properties: [{ name: "Logger", type: "ILogger<OrdersController>" }],
          fields: [],
        },
      ],
      errors: [],
    };
    expect(AnalysisResultSchema.safeParse(result).success).toBe(true);
  });

  test("validates empty result", () => {
    const result = { types: [], errors: [] };
    expect(AnalysisResultSchema.safeParse(result).success).toBe(true);
  });

  test("validates result with errors", () => {
    const result = {
      types: [],
      errors: [{ attribute: "Missing", message: "Attribute symbol not found" }],
    };
    expect(AnalysisResultSchema.safeParse(result).success).toBe(true);
  });
});

describe("lspKindToTypeKind", () => {
  test("maps class", () => {
    expect(lspKindToTypeKind(LSP_KIND.CLASS)).toBe("class");
  });

  test("maps struct", () => {
    expect(lspKindToTypeKind(LSP_KIND.STRUCT)).toBe("struct");
  });

  test("maps interface", () => {
    expect(lspKindToTypeKind(LSP_KIND.INTERFACE)).toBe("interface");
  });

  test("maps enum", () => {
    expect(lspKindToTypeKind(LSP_KIND.ENUM)).toBe("enum");
  });

  test("returns null for method kind", () => {
    expect(lspKindToTypeKind(LSP_KIND.METHOD)).toBeNull();
  });

  test("returns null for unknown kind", () => {
    expect(lspKindToTypeKind(999)).toBeNull();
  });
});
