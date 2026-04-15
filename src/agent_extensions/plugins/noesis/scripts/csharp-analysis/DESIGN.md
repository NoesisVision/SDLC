# C# Attributed Types Analysis Script — Design

## Goal

Deterministic script that queries a C# codebase via Serena MCP to extract semantic type information for all types decorated with given attributes. No agent involvement — pure script logic with predictable MCP call sequences.

## Input

```json
{
  "serena": {
    "command": "path/to/serena-server",
    "args": ["--project", "/path/to/csharp/project"]
  },
  "attributes": ["ApiController", "HttpPost", "Authorize"]
}
```

- `serena` — server spawn configuration (command + args for `StdioClientTransport`)
- `attributes` — simple names or fully-qualified names of C# attributes to search for

Passed as a single JSON file path argument: `bun run find-attributed-types.ts config.json`

## Output

```json
{
  "types": [
    {
      "name": "OrdersController",
      "fullyQualifiedName": "MyApp.Controllers.OrdersController",
      "namespace": "MyApp.Controllers",
      "kind": "class",
      "filePath": "src/Controllers/OrdersController.cs",
      "attributes": ["ApiController", "Route"],
      "methods": [
        {
          "name": "GetOrder",
          "returnType": "Task<ActionResult<OrderDto>>",
          "parameters": [
            { "name": "id", "type": "int" },
            { "name": "cancellationToken", "type": "CancellationToken" }
          ]
        }
      ],
      "properties": [
        { "name": "Logger", "type": "ILogger<OrdersController>" }
      ],
      "fields": [
        { "name": "_repository", "type": "IOrderRepository" }
      ]
    }
  ]
}
```

All type references are fully-qualified as resolved by the C# language server (Roslyn/OmniSharp), not string names from source text.

## Architecture

```
scripts/csharp-analysis/
├── types.ts                    # Zod schemas for input config and output
├── serena-client.ts            # MCP client wrapper — typed calls to Serena tools
├── find-attributed-types.ts    # Main script (entry point)
├── find-attributed-types.test.ts
└── serena-client.test.ts
```

## Algorithm

### Step 1 — Connect to Serena

Spawn Serena MCP server as a child process via `@modelcontextprotocol/sdk` `StdioClientTransport`. Initialize the MCP `Client`, perform handshake.

```typescript
const transport = new StdioClientTransport({
  command: config.serena.command,
  args: config.serena.args,
});
const client = new Client({ name: "csharp-analysis", version: "1.0.0" });
await client.connect(transport);
```

### Step 2 — Locate attribute symbols

For each attribute name, call `find_symbol` to locate its definition:

```
find_symbol(name_path_pattern: "ApiControllerAttribute", include_kinds: [5])
```

LSP symbol kind 5 = Class. C# attributes are classes inheriting `System.Attribute`. Try both `FooAttribute` and `Foo` naming conventions.

If the attribute is from an external dependency (e.g., ASP.NET), `find_symbol` may return an external reference identifier (`<ext...>`). Store this for the next step.

### Step 3 — Find all types decorated with each attribute

Call `find_referencing_symbols` for each attribute, filtering to type-level symbols:

```
find_referencing_symbols(
  name_path: "ApiControllerAttribute",
  relative_path: "<path-from-step-2>",
  include_kinds: [5, 23, 11]   // Class=5, Struct=23, Interface=11
)
```

This returns all symbols that reference the attribute. Since attributes in C# are syntactic decorators on types, the referencing symbol is the decorated type itself.

**Deduplication**: A type may reference the same attribute multiple times (constructor, named args). Deduplicate by `(name_path, relative_path)`.

### Step 4 — Extract type details

For each discovered type, make two calls:

**4a** — Get children (methods, properties, fields):

```
find_symbol(
  name_path_pattern: "OrdersController",
  relative_path: "src/Controllers/OrdersController.cs",
  depth: 1,
  include_info: true
)
```

`include_info: true` triggers hover resolution, which gives fully-qualified type signatures from Roslyn.

**4b** — Get namespace:

The namespace is derived from the symbol hierarchy. In C#, `get_symbols_overview` on the file shows the namespace as a top-level symbol (LSP kind 3 = Namespace):

```
get_symbols_overview(
  relative_path: "src/Controllers/OrdersController.cs",
  depth: 0
)
```

### Step 5 — Filter and classify members

From Step 4a results, filter children by LSP symbol kind:

| LSP Kind | C# Concept |
|----------|------------|
| 6        | Method     |
| 7        | Property   |
| 8        | Field      |
| 12       | Constructor (skip or include separately) |

**Public filter**: The `info` field from `include_info: true` contains the full signature including access modifiers. Parse for `public` keyword prefix. Alternatively, use `include_body: true` and check the first token.

### Step 6 — Parse type signatures from info

The `info` field (hover data) from Roslyn LSP returns structured type information:

- **Methods**: `public Task<ActionResult<OrderDto>> GetOrder(int id, CancellationToken ct)` — parse return type and parameter types from the signature string.
- **Properties**: `public ILogger<OrdersController> Logger { get; }` — parse type before the name.
- **Fields**: `private readonly IOrderRepository _repository` — parse type before the name.

These are fully-resolved types from the compiler, not source-text strings.

### Step 7 — Assemble and output

Build the output JSON, validate with Zod schema, write to stdout.

## Serena Call Sequence (per attribute)

```
1. find_symbol(attribute_name)                          → attribute location
2. find_referencing_symbols(attribute, include_kinds)   → decorated types
   For each type:
3.   get_symbols_overview(file)                         → namespace
4.   find_symbol(type, depth=1, include_info=true)      → members with types
```

**Total calls**: `A × (1 + 1) + T × 2` where A = number of attributes, T = number of unique types found.

## Type Signature Parsing

Roslyn hover info follows predictable patterns. A regex-based parser handles:

```
// Method
public async Task<List<OrderDto>> GetOrders(int page, string filter)
→ returnType: "Task<List<OrderDto>>"
→ parameters: [{ name: "page", type: "int" }, { name: "filter", type: "string" }]

// Property
public string Name { get; set; }
→ type: "string"

// Field
private readonly IOrderRepository _repo
→ type: "IOrderRepository"
```

Generic types with nested angle brackets require balanced-bracket parsing, not simple regex splits.

## Dependencies

```json
{
  "@modelcontextprotocol/sdk": "^1.x",
  "zod": "^4.x"
}
```

Both already available or trivially addable to the plugin's `package.json`.

## Future Extensions

### Method invocations

Use `find_referencing_symbols` on a method to discover all call sites:

```
find_referencing_symbols(
  name_path: "OrdersController/GetOrder",
  relative_path: "src/Controllers/OrdersController.cs"
)
```

Returns caller symbols with code snippets. This can be chained to build a call graph.

### Inheritance

Two directions:

1. **Find base types**: Use `include_info: true` on a class — Roslyn hover shows `class Foo : Bar, IFoo`. Parse the base class and interfaces from the signature.

2. **Find derived types**: Use `find_referencing_symbols` on a base class/interface with `include_kinds: [5, 23, 11]`. Implementations and subclasses reference the base type in their declarations.

### Planned script additions

```
scripts/csharp-analysis/
├── find-attributed-types.ts      # ← this design
├── find-call-graph.ts            # method invocation tracing
├── find-type-hierarchy.ts        # inheritance tree
└── ...
```

All scripts share `serena-client.ts` and `types.ts`.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Attribute not found (external dependency) | Step 2 returns empty | `find_symbol` may return external identifiers (`<ext...>`). Use those as `relative_path` in `find_referencing_symbols`. If truly not found, report in output as `{ attribute, status: "not_found" }`. |
| Hover info format varies | Type parsing breaks | Build parser with test cases from actual Roslyn output. Fall back to raw `info` string if parsing fails. |
| Large codebase, many types | Slow, many MCP calls | Parallelize Step 4 calls with bounded concurrency (`Promise.all` with batches of ~10). |
| Serena project not activated for C# | All calls fail | Script verifies project activation as first step; fails fast with clear error if C# language server is not configured. |
| Public filter unreliable from info | Include non-public members | Double-check with `include_body: true` for ambiguous cases. Default to inclusive (include member, mark accessibility as "unknown"). |
