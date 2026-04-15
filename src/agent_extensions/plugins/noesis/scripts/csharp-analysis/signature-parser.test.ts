import { describe, expect, test } from "bun:test";
import {
  parseMethodSignature,
  parsePropertySignature,
  parseFieldSignature,
  isPublic,
} from "./signature-parser.js";

describe("isPublic", () => {
  test("returns true for public signature", () => {
    expect(isPublic("public void Foo()")).toBe(true);
  });

  test("returns false for private signature", () => {
    expect(isPublic("private void Foo()")).toBe(false);
  });

  test("returns false for internal signature", () => {
    expect(isPublic("internal void Foo()")).toBe(false);
  });

  test("returns false for protected signature", () => {
    expect(isPublic("protected void Foo()")).toBe(false);
  });
});

describe("parseMethodSignature", () => {
  test("parses simple method", () => {
    const result = parseMethodSignature("public void DoSomething()");
    expect(result).toEqual({
      name: "DoSomething",
      returnType: "void",
      parameters: [],
    });
  });

  test("parses method with parameters", () => {
    const result = parseMethodSignature("public string GetName(int id, string filter)");
    expect(result).toEqual({
      name: "GetName",
      returnType: "string",
      parameters: [
        { name: "id", type: "int" },
        { name: "filter", type: "string" },
      ],
    });
  });

  test("parses async method with generic return type", () => {
    const result = parseMethodSignature(
      "public async Task<ActionResult<OrderDto>> GetOrder(int id, CancellationToken ct)",
    );
    expect(result).toEqual({
      name: "GetOrder",
      returnType: "Task<ActionResult<OrderDto>>",
      parameters: [
        { name: "id", type: "int" },
        { name: "ct", type: "CancellationToken" },
      ],
    });
  });

  test("parses method with generic parameters", () => {
    const result = parseMethodSignature(
      "public List<string> Filter(Dictionary<string, int> map, Func<int, bool> predicate)",
    );
    expect(result).toEqual({
      name: "Filter",
      returnType: "List<string>",
      parameters: [
        { name: "map", type: "Dictionary<string, int>" },
        { name: "predicate", type: "Func<int, bool>" },
      ],
    });
  });

  test("parses static method", () => {
    const result = parseMethodSignature("public static int Parse(string value)");
    expect(result).toEqual({
      name: "Parse",
      returnType: "int",
      parameters: [{ name: "value", type: "string" }],
    });
  });

  test("parses virtual method", () => {
    const result = parseMethodSignature("public virtual void OnInit()");
    expect(result).toEqual({
      name: "OnInit",
      returnType: "void",
      parameters: [],
    });
  });

  test("parses method with ref/out parameters", () => {
    const result = parseMethodSignature("public bool TryParse(string input, out int result)");
    expect(result).toEqual({
      name: "TryParse",
      returnType: "bool",
      parameters: [
        { name: "input", type: "string" },
        { name: "result", type: "int" },
      ],
    });
  });

  test("parses method with params array", () => {
    const result = parseMethodSignature("public void Log(string message, params object[] args)");
    expect(result).toEqual({
      name: "Log",
      returnType: "void",
      parameters: [
        { name: "message", type: "string" },
        { name: "args", type: "object[]" },
      ],
    });
  });

  test("parses method with default parameter", () => {
    const result = parseMethodSignature("public void Connect(string host, int port = 8080)");
    expect(result).toEqual({
      name: "Connect",
      returnType: "void",
      parameters: [
        { name: "host", type: "string" },
        { name: "port", type: "int" },
      ],
    });
  });

  test("returns null for private method", () => {
    expect(parseMethodSignature("private void Secret()")).toBeNull();
  });

  test("returns null for protected method", () => {
    expect(parseMethodSignature("protected void OnChange()")).toBeNull();
  });

  test("handles multiline info by finding signature line", () => {
    const info = `/// <summary>Gets order by ID</summary>\npublic async Task<OrderDto> GetOrder(int id)`;
    const result = parseMethodSignature(info);
    expect(result).toEqual({
      name: "GetOrder",
      returnType: "Task<OrderDto>",
      parameters: [{ name: "id", type: "int" }],
    });
  });

  test("parses override async method", () => {
    const result = parseMethodSignature("public override async Task<IActionResult> Execute()");
    expect(result).toEqual({
      name: "Execute",
      returnType: "Task<IActionResult>",
      parameters: [],
    });
  });
});

describe("parsePropertySignature", () => {
  test("parses simple property", () => {
    const result = parsePropertySignature("public string Name { get; set; }");
    expect(result).toEqual({ name: "Name", type: "string" });
  });

  test("parses readonly property", () => {
    const result = parsePropertySignature("public int Count { get; }");
    expect(result).toEqual({ name: "Count", type: "int" });
  });

  test("parses generic property", () => {
    const result = parsePropertySignature("public ILogger<OrdersController> Logger { get; set; }");
    expect(result).toEqual({ name: "Logger", type: "ILogger<OrdersController>" });
  });

  test("parses static property", () => {
    const result = parsePropertySignature("public static string Default { get; }");
    expect(result).toEqual({ name: "Default", type: "string" });
  });

  test("returns null for private property", () => {
    expect(parsePropertySignature("private int _count { get; set; }")).toBeNull();
  });

  test("parses nullable property", () => {
    const result = parsePropertySignature("public string? Description { get; set; }");
    expect(result).toEqual({ name: "Description", type: "string?" });
  });

  test("parses property with nested generics", () => {
    const result = parsePropertySignature(
      "public Dictionary<string, List<int>> Mapping { get; }",
    );
    expect(result).toEqual({ name: "Mapping", type: "Dictionary<string, List<int>>" });
  });
});

describe("parseFieldSignature", () => {
  test("parses public field", () => {
    const result = parseFieldSignature("public int MaxRetries;");
    expect(result).toEqual({ name: "MaxRetries", type: "int" });
  });

  test("parses public readonly field", () => {
    const result = parseFieldSignature("public readonly string ConnectionString;");
    expect(result).toEqual({ name: "ConnectionString", type: "string" });
  });

  test("parses public static field", () => {
    const result = parseFieldSignature("public static readonly int DefaultTimeout;");
    expect(result).toEqual({ name: "DefaultTimeout", type: "int" });
  });

  test("parses public field with generic type", () => {
    const result = parseFieldSignature("public IReadOnlyList<string> Items;");
    expect(result).toEqual({ name: "Items", type: "IReadOnlyList<string>" });
  });

  test("returns null for private field", () => {
    expect(parseFieldSignature("private readonly IOrderRepository _repository;")).toBeNull();
  });

  test("parses field with initializer", () => {
    const result = parseFieldSignature("public int Timeout = 30;");
    expect(result).toEqual({ name: "Timeout", type: "int" });
  });

  test("parses const field", () => {
    const result = parseFieldSignature("public const string Version;");
    expect(result).toEqual({ name: "Version", type: "string" });
  });
});
