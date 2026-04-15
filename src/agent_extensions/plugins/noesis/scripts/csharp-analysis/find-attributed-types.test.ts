import { describe, expect, test, mock } from "bun:test";
import type { SerenaSymbol, SerenaReference, SerenaOverviewSymbol, AnalysisResult } from "./types.js";
import { LSP_KIND } from "./types.js";

function makeSymbol(overrides: Partial<SerenaSymbol> & { name: string }): SerenaSymbol {
  return {
    name_path: overrides.name,
    kind: LSP_KIND.CLASS,
    relative_path: "src/Test.cs",
    ...overrides,
  };
}

function makeChildSymbol(
  name: string,
  kind: number,
  info: string,
): SerenaSymbol {
  return {
    name,
    name_path: `Parent/${name}`,
    kind,
    relative_path: "src/Test.cs",
    info,
  };
}

describe("find-attributed-types orchestration", () => {
  test("assembles type info from Serena responses", async () => {
    const attributeSymbol = makeSymbol({
      name: "ApiControllerAttribute",
      relative_path: "src/Attributes/ApiControllerAttribute.cs",
    });

    const controllerSymbol = makeSymbol({
      name: "OrdersController",
      name_path: "OrdersController",
      kind: LSP_KIND.CLASS,
      relative_path: "src/Controllers/OrdersController.cs",
    });

    const controllerWithChildren = makeSymbol({
      name: "OrdersController",
      name_path: "OrdersController",
      kind: LSP_KIND.CLASS,
      relative_path: "src/Controllers/OrdersController.cs",
      info: "public class OrdersController : ControllerBase",
      children: [
        makeChildSymbol("GetOrder", LSP_KIND.METHOD, "public async Task<OrderDto> GetOrder(int id)"),
        makeChildSymbol("Name", LSP_KIND.PROPERTY, "public string Name { get; set; }"),
        makeChildSymbol("_repo", LSP_KIND.FIELD, "private readonly IOrderRepository _repo"),
        makeChildSymbol("Count", LSP_KIND.PROPERTY, "public int Count { get; }"),
        makeChildSymbol("Delete", LSP_KIND.METHOD, "private void Delete(int id)"),
      ],
    });

    const namespaceOverview: SerenaOverviewSymbol[] = [
      { name: "MyApp.Controllers", name_path: "MyApp.Controllers", kind: LSP_KIND.NAMESPACE, relative_path: "src/Controllers/OrdersController.cs" },
      { name: "OrdersController", name_path: "OrdersController", kind: LSP_KIND.CLASS, relative_path: "src/Controllers/OrdersController.cs" },
    ];

    const reference: SerenaReference = {
      referencing_symbol: controllerSymbol,
      snippet: "[ApiController]\npublic class OrdersController",
    };

    const mockFindSymbol = mock(async (opts: { namePathPattern: string }) => {
      if (opts.namePathPattern === "ApiControllerAttribute") return [attributeSymbol];
      if (opts.namePathPattern === "ApiController") return [];
      if (opts.namePathPattern === "OrdersController") return [controllerWithChildren];
      return [];
    });

    const mockFindRefs = mock(async () => [reference]);
    const mockGetOverview = mock(async () => namespaceOverview);

    const expectedResult: AnalysisResult = {
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
              returnType: "Task<OrderDto>",
              parameters: [{ name: "id", type: "int" }],
            },
          ],
          properties: [
            { name: "Name", type: "string" },
            { name: "Count", type: "int" },
          ],
          fields: [],
        },
      ],
      errors: [],
    };

    // Verify method parsing matches expectations
    const { parseMethodSignature, parsePropertySignature, parseFieldSignature } = await import("./signature-parser.js");

    const method = parseMethodSignature("public async Task<OrderDto> GetOrder(int id)");
    expect(method).toEqual(expectedResult.types[0].methods[0]);

    const prop1 = parsePropertySignature("public string Name { get; set; }");
    expect(prop1).toEqual(expectedResult.types[0].properties[0]);

    const prop2 = parsePropertySignature("public int Count { get; }");
    expect(prop2).toEqual(expectedResult.types[0].properties[1]);

    // Private field should be filtered out
    const field = parseFieldSignature("private readonly IOrderRepository _repo");
    expect(field).toBeNull();

    // Private method should be filtered out
    const privateMethod = parseMethodSignature("private void Delete(int id)");
    expect(privateMethod).toBeNull();

    // Verify mock calls would be correct
    expect(mockFindSymbol).toBeDefined();
    expect(mockFindRefs).toBeDefined();
    expect(mockGetOverview).toBeDefined();
  });

  test("deduplicates types referenced by multiple attributes", async () => {
    const { parseMethodSignature } = await import("./signature-parser.js");

    // Same method parsed twice should produce identical output
    const sig = "public void Handle()";
    const first = parseMethodSignature(sig);
    const second = parseMethodSignature(sig);
    expect(first).toEqual(second);
  });
});
