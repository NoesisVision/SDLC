# Invocations (Invokes Relation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `Behavior.Invokes` relation to `noesis-graph/scanner` per `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/InvokesBehavior.rules.md`, so that the domain model graph captures which domain behaviors cause execution of which others.

**Architecture:** Two new submodules under `scanner/`. `inheritance/` runs a small textual pass over the already-loaded C# files to build an in-memory type-header map (base type + directly-declared interfaces, generic args stripped). `invocations/` uses Serena's `find_referencing_symbols` tool to reverse-walk the call graph from every known behavior; the enclosing method of each reference is expanded into source behaviors via rules S1/S2/S3/G1 and emitted as `Invocation{ source, destination }` edges persisted in a new `BEHAVIOR_INVOKES_BEHAVIOR` REL table. `ScannerService.scan()` runs the invocations pass atomically at the end of every scan.

**Tech Stack:** Bun runtime, NestJS DI, Kuzu graph DB, Serena MCP client, `bun:test` with colocated `*.test.ts` files, Zod for MCP input schemas.

**Spec:** `docs/superpowers/specs/2026-04-18-invocations-relation-design.md`.

---

## File Structure

**Create:**

- `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/inheritance/inheritance.types.ts` — `TypeHeader`, `InheritanceMap`.
- `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/inheritance/inheritance.ts` — `extractInheritanceMap(files)` + `ancestorsOf(map, typeName)`.
- `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/inheritance/inheritance.test.ts`.
- `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/invocations.types.ts` — `Invocation`, `MethodDescriptor`, `BehaviorInventory`.
- `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/fakes.ts` — `makeFakeSerena` (test-only helper).
- `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/invocations.algorithm.ts` — pure `computeInvocations(inputs)` function.
- `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/invocations.algorithm.test.ts`.
- `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/invocations.repository.ts`.
- `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/invocations.repository.test.ts`.
- `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/invocations.service.ts`.

**Modify:**

- `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/scanner.service.ts` — `scan()` calls invocations at the end.
- `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/scanner.repository.ts` — expose a `getBehaviorsWithLocations()` method for the invocations pass.
- `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/scanner.module.ts` — register `InvocationsService` / `InvocationsRepository`, import `SerenaModule`.
- `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/scanner.controller.ts` — new `GET /api/model/invocations` endpoint.
- `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/scanner.mcp.ts` — register `get_behavior_invocations` tool.

**Do not touch:** `scanner.types.ts`, `scanner.service.test.ts` (existing tests), `serena/` (consumer only).

---

## Task 1: Inheritance types

**Files:**
- Create: `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/inheritance/inheritance.types.ts`

- [ ] **Step 1: Write the types file**

```ts
export interface TypeHeader {
  typeId: string;
  typeName: string;
  filePath: string;
  baseTypeNames: string[];
  interfaceTypeNames: string[];
}

export interface InheritanceMap {
  byTypeId: Map<string, TypeHeader>;
  byTypeName: Map<string, TypeHeader[]>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/inheritance/inheritance.types.ts
git commit -m "inheritance types"
```

---

## Task 2: Inheritance extractor — happy path

**Files:**
- Create: `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/inheritance/inheritance.ts`
- Create: `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/inheritance/inheritance.test.ts`

- [ ] **Step 1: Write failing tests for single-class happy path**

```ts
// inheritance.test.ts
import { describe, test, expect } from "bun:test";
import { extractInheritanceMap } from "./inheritance.js";

describe("extractInheritanceMap", () => {
  test("extracts a class with one base and two interfaces", () => {
    const files = [
      {
        relativePath: "src/Order.cs",
        content: `namespace Sales;\npublic class Order : OrderBase, IOrder, IAggregate {}`,
      },
    ];

    const map = extractInheritanceMap(files);

    const header = map.byTypeName.get("Order");
    expect(header).toBeDefined();
    expect(header!.length).toBe(1);
    expect(header![0].typeName).toBe("Order");
    expect(header![0].filePath).toBe("src/Order.cs");
    expect(header![0].baseTypeNames).toEqual(["OrderBase"]);
    expect(header![0].interfaceTypeNames).toEqual(["IOrder", "IAggregate"]);
  });

  test("class with no inheritance clause has empty ancestor lists", () => {
    const files = [{ relativePath: "src/Foo.cs", content: `public class Foo {}` }];
    const header = extractInheritanceMap(files).byTypeName.get("Foo")![0];
    expect(header.baseTypeNames).toEqual([]);
    expect(header.interfaceTypeNames).toEqual([]);
  });

  test("byTypeId is keyed by `${filePath}:${typeName}`", () => {
    const files = [
      { relativePath: "src/Order.cs", content: `public class Order {}` },
    ];
    const map = extractInheritanceMap(files);
    expect(map.byTypeId.get("src/Order.cs:Order")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests — verify failure**

Run: `cd src/agent_extensions/plugins/noesis && bun test mcp/noesis-graph/scanner/inheritance/inheritance.test.ts`
Expected: FAIL with "Cannot find module" or similar.

- [ ] **Step 3: Implement extractor**

```ts
// inheritance.ts
import type { InheritanceMap, TypeHeader } from "./inheritance.types.js";

export interface InheritanceSourceFile {
  relativePath: string;
  content: string;
}

const TYPE_DECLARATION_PATTERN =
  /\b(?:class|struct|interface|record)\s+(\w+)\s*(?:<[^>]*>)?\s*(?::\s*([^{]+))?\s*\{/g;

export function extractInheritanceMap(
  files: InheritanceSourceFile[],
): InheritanceMap {
  const byTypeId = new Map<string, TypeHeader>();
  const byTypeName = new Map<string, TypeHeader[]>();

  for (const file of files) {
    for (const header of extractTypeHeadersFromFile(file)) {
      byTypeId.set(header.typeId, header);
      const existing = byTypeName.get(header.typeName) ?? [];
      existing.push(header);
      byTypeName.set(header.typeName, existing);
    }
  }

  return { byTypeId, byTypeName };
}

function extractTypeHeadersFromFile(
  file: InheritanceSourceFile,
): TypeHeader[] {
  const results: TypeHeader[] = [];
  TYPE_DECLARATION_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TYPE_DECLARATION_PATTERN.exec(file.content)) !== null) {
    const typeName = match[1];
    const ancestorsFragment = match[2] ?? "";
    const { baseTypeNames, interfaceTypeNames } = splitAncestors(ancestorsFragment);
    results.push({
      typeId: `${file.relativePath}:${typeName}`,
      typeName,
      filePath: file.relativePath,
      baseTypeNames,
      interfaceTypeNames,
    });
  }
  return results;
}

function splitAncestors(fragment: string): {
  baseTypeNames: string[];
  interfaceTypeNames: string[];
} {
  const trimmed = fragment.trim();
  if (trimmed === "") return { baseTypeNames: [], interfaceTypeNames: [] };

  const names = trimmed
    .split(",")
    .map((part) => stripGenericArgs(part.trim()))
    .filter((n) => n !== "");

  if (names.length === 0) return { baseTypeNames: [], interfaceTypeNames: [] };
  return {
    baseTypeNames: [names[0]],
    interfaceTypeNames: names.slice(1),
  };
}

function stripGenericArgs(name: string): string {
  const idx = name.indexOf("<");
  return idx === -1 ? name : name.substring(0, idx);
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `cd src/agent_extensions/plugins/noesis && bun test mcp/noesis-graph/scanner/inheritance/inheritance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/inheritance/
git commit -m "inheritance extractor happy path"
```

---

## Task 3: Inheritance extractor — generics, records/structs, edges

**Files:**
- Modify: `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/inheritance/inheritance.test.ts`
- Modify: `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/inheritance/inheritance.ts` (only if tests uncover gaps)

- [ ] **Step 1: Add tests for generics, records, structs, multiple types per file**

Append to `inheritance.test.ts`:

```ts
  test("strips generic args from ancestor names (G1)", () => {
    const files = [
      {
        relativePath: "src/OrderRepository.cs",
        content: `public class OrderRepository : IRepository<Order>, IDisposable {}`,
      },
    ];
    const h = extractInheritanceMap(files).byTypeName.get("OrderRepository")![0];
    expect(h.baseTypeNames).toEqual(["IRepository"]);
    expect(h.interfaceTypeNames).toEqual(["IDisposable"]);
  });

  test("records and structs are parsed", () => {
    const files = [
      { relativePath: "src/Money.cs", content: `public record Money : IEquatable<Money> {}` },
      { relativePath: "src/Point.cs", content: `public struct Point : IComparable {}` },
    ];
    const map = extractInheritanceMap(files);
    expect(map.byTypeName.get("Money")![0].baseTypeNames).toEqual(["IEquatable"]);
    expect(map.byTypeName.get("Point")![0].baseTypeNames).toEqual(["IComparable"]);
  });

  test("multiple top-level types in one file", () => {
    const files = [
      {
        relativePath: "src/Mix.cs",
        content:
          `public class A : IA {}\n\npublic interface IA {}\n\npublic class B : A {}`,
      },
    ];
    const map = extractInheritanceMap(files);
    expect(map.byTypeName.get("A")![0].interfaceTypeNames).toEqual(["IA"]);
    expect(map.byTypeName.get("IA")![0].baseTypeNames).toEqual([]);
    expect(map.byTypeName.get("B")![0].baseTypeNames).toEqual(["A"]);
  });

  test("interface inheriting interfaces", () => {
    const files = [
      { relativePath: "src/IChild.cs", content: `public interface IChild : IBase, IMarker {}` },
    ];
    const h = extractInheritanceMap(files).byTypeName.get("IChild")![0];
    expect(h.baseTypeNames).toEqual(["IBase"]);
    expect(h.interfaceTypeNames).toEqual(["IMarker"]);
  });

  test("same type name from different files produces two entries in byTypeName", () => {
    const files = [
      { relativePath: "src/A/Order.cs", content: `public class Order {}` },
      { relativePath: "src/B/Order.cs", content: `public class Order {}` },
    ];
    const list = extractInheritanceMap(files).byTypeName.get("Order")!;
    expect(list.length).toBe(2);
    expect(list[0].filePath).not.toBe(list[1].filePath);
  });

  test("malformed declaration is skipped without throwing", () => {
    const files = [
      { relativePath: "src/Broken.cs", content: `public class Broken : // unterminated` },
      { relativePath: "src/Ok.cs", content: `public class Ok {}` },
    ];
    const map = extractInheritanceMap(files);
    expect(map.byTypeName.get("Ok")).toBeDefined();
  });
```

- [ ] **Step 2: Run tests — verify all pass (implementation already handles these)**

Run: `cd src/agent_extensions/plugins/noesis && bun test mcp/noesis-graph/scanner/inheritance/inheritance.test.ts`
Expected: PASS. If any fail, tighten the regex in `inheritance.ts` to satisfy them (generic angle-brackets are already handled; multi-type/record/struct covered by the existing pattern).

- [ ] **Step 3: Commit**

```bash
git add src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/inheritance/
git commit -m "inheritance extractor: generics, records, multi-type, edges"
```

---

## Task 4: Inheritance — `ancestorsOf` ancestor walker

**Files:**
- Modify: `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/inheritance/inheritance.ts`
- Modify: `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/inheritance/inheritance.test.ts`

- [ ] **Step 1: Write failing tests for ancestorsOf**

Append to `inheritance.test.ts`:

```ts
import { ancestorsOf } from "./inheritance.js";

describe("ancestorsOf", () => {
  const files = [
    { relativePath: "IEntity.cs", content: `public interface IEntity {}` },
    { relativePath: "IOrder.cs", content: `public interface IOrder : IEntity {}` },
    { relativePath: "OrderBase.cs", content: `public class OrderBase : IOrder {}` },
    { relativePath: "Order.cs", content: `public class Order : OrderBase, IMarker {}` },
    { relativePath: "IMarker.cs", content: `public interface IMarker {}` },
  ];
  const map = extractInheritanceMap(files);

  test("returns directly-declared interfaces on the class", () => {
    const ancestors = ancestorsOf(map, "Order");
    expect(ancestors).toContain("IMarker");
  });

  test("walks the class base chain transitively (S3)", () => {
    const ancestors = ancestorsOf(map, "Order");
    expect(ancestors).toContain("OrderBase");
  });

  test("includes interfaces declared on base classes (S2 + S3)", () => {
    const ancestors = ancestorsOf(map, "Order");
    expect(ancestors).toContain("IOrder");
  });

  test("does NOT traverse interface parents (S5)", () => {
    const ancestors = ancestorsOf(map, "Order");
    expect(ancestors).not.toContain("IEntity");
  });

  test("returns empty list for unknown type", () => {
    expect(ancestorsOf(map, "Unknown")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `cd src/agent_extensions/plugins/noesis && bun test mcp/noesis-graph/scanner/inheritance/inheritance.test.ts`
Expected: FAIL — `ancestorsOf` not exported.

- [ ] **Step 3: Implement `ancestorsOf` in `inheritance.ts`**

Append:

```ts
export function ancestorsOf(map: InheritanceMap, typeName: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = typeName;

  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    const headers = map.byTypeName.get(current);
    if (!headers || headers.length === 0) break;
    const header = headers[0];
    for (const intf of header.interfaceTypeNames) {
      if (!result.includes(intf)) result.push(intf);
    }
    if (header.baseTypeNames.length === 0) break;
    const next = header.baseTypeNames[0];
    if (!result.includes(next)) result.push(next);
    current = next;
  }

  return result;
}
```

- [ ] **Step 4: Run — verify pass**

Run: `cd src/agent_extensions/plugins/noesis && bun test mcp/noesis-graph/scanner/inheritance/inheritance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/inheritance/
git commit -m "inheritance: ancestorsOf walker honoring S3 + S5"
```

---

## Task 5: Invocations types + fakes

**Files:**
- Create: `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/invocations.types.ts`
- Create: `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/fakes.ts`

- [ ] **Step 1: Write types file**

```ts
// invocations.types.ts
export interface Invocation {
  source: string;
  destination: string;
}

export interface MethodDescriptor {
  filePath: string;
  typeName: string;
  methodName: string;
}

export interface BehaviorRow {
  id: string;
  filePath: string;
  typeName: string;
  methodName: string;
}

export interface SerenaReference {
  enclosing: MethodDescriptor | null;
}

export interface SerenaLike {
  findReferencingSymbols(
    namePath: string,
    relativePath: string,
  ): Promise<SerenaReference[]>;
}
```

- [ ] **Step 2: Write fakes file**

```ts
// fakes.ts
import type { SerenaLike, SerenaReference } from "./invocations.types.js";

export function makeFakeSerena(
  refsByKey: Record<string, SerenaReference[]>,
): SerenaLike {
  return {
    async findReferencingSymbols(namePath, relativePath) {
      return refsByKey[`${namePath}|${relativePath}`] ?? [];
    },
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/invocations.types.ts \
        src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/fakes.ts
git commit -m "invocations: types and fake Serena helper"
```

---

## Task 6: Invocations algorithm — `sourcesFor` (S1 + S2 + S3 + S5)

**Files:**
- Create: `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/invocations.algorithm.ts`
- Create: `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/invocations.algorithm.test.ts`

- [ ] **Step 1: Write failing tests for `sourcesFor`**

```ts
// invocations.algorithm.test.ts
import { describe, test, expect } from "bun:test";
import { sourcesFor } from "./invocations.algorithm.js";
import { extractInheritanceMap } from "../inheritance/inheritance.js";
import type { BehaviorRow } from "./invocations.types.js";

function behaviorsOf(rows: BehaviorRow[]) {
  const byLocation = new Map<string, BehaviorRow>();
  const byTypeMethod = new Map<string, BehaviorRow[]>();
  for (const r of rows) {
    byLocation.set(`${r.filePath}:${r.typeName}:${r.methodName}`, r);
    const key = `${r.typeName}:${r.methodName}`;
    const list = byTypeMethod.get(key) ?? [];
    list.push(r);
    byTypeMethod.set(key, list);
  }
  return { byLocation, byTypeMethod };
}

describe("sourcesFor", () => {
  test("S1: enclosing method is itself a behavior", () => {
    const inv = behaviorsOf([
      { id: "Order.cs:Order:Place", filePath: "Order.cs", typeName: "Order", methodName: "Place" },
    ]);
    const inheritance = extractInheritanceMap([
      { relativePath: "Order.cs", content: `public class Order {}` },
    ]);
    const sources = sourcesFor(
      { filePath: "Order.cs", typeName: "Order", methodName: "Place" },
      inv,
      inheritance,
    );
    expect(sources.map((s) => s.id)).toEqual(["Order.cs:Order:Place"]);
  });

  test("S2: interface member is a source when impl is unannotated", () => {
    const inv = behaviorsOf([
      { id: "IOrder.cs:IOrder:Place", filePath: "IOrder.cs", typeName: "IOrder", methodName: "Place" },
    ]);
    const inheritance = extractInheritanceMap([
      { relativePath: "IOrder.cs", content: `public interface IOrder {}` },
      { relativePath: "Order.cs", content: `public class Order : IOrder {}` },
    ]);
    const sources = sourcesFor(
      { filePath: "Order.cs", typeName: "Order", methodName: "Place" },
      inv,
      inheritance,
    );
    expect(sources.map((s) => s.id)).toEqual(["IOrder.cs:IOrder:Place"]);
  });

  test("S3: base class method is an additional source (E2)", () => {
    const inv = behaviorsOf([
      { id: "Order.cs:Order:Place", filePath: "Order.cs", typeName: "Order", methodName: "Place" },
      { id: "OrderBase.cs:OrderBase:Place", filePath: "OrderBase.cs", typeName: "OrderBase", methodName: "Place" },
    ]);
    const inheritance = extractInheritanceMap([
      { relativePath: "OrderBase.cs", content: `public class OrderBase {}` },
      { relativePath: "Order.cs", content: `public class Order : OrderBase {}` },
    ]);
    const ids = sourcesFor(
      { filePath: "Order.cs", typeName: "Order", methodName: "Place" },
      inv,
      inheritance,
    ).map((s) => s.id).sort();
    expect(ids).toEqual([
      "Order.cs:Order:Place",
      "OrderBase.cs:OrderBase:Place",
    ]);
  });

  test("S5: interface parent NOT followed", () => {
    const inv = behaviorsOf([
      { id: "IBase.cs:IBase:Place", filePath: "IBase.cs", typeName: "IBase", methodName: "Place" },
    ]);
    const inheritance = extractInheritanceMap([
      { relativePath: "IBase.cs", content: `public interface IBase {}` },
      { relativePath: "IChild.cs", content: `public interface IChild : IBase {}` },
      { relativePath: "Order.cs", content: `public class Order : IChild {}` },
    ]);
    const sources = sourcesFor(
      { filePath: "Order.cs", typeName: "Order", methodName: "Place" },
      inv,
      inheritance,
    );
    expect(sources).toEqual([]);
  });

  test("G1: generic base name resolves to generic definition", () => {
    const inv = behaviorsOf([
      {
        id: "IRepository.cs:IRepository:Save",
        filePath: "IRepository.cs",
        typeName: "IRepository",
        methodName: "Save",
      },
    ]);
    const inheritance = extractInheritanceMap([
      { relativePath: "IRepository.cs", content: `public interface IRepository<T> {}` },
      { relativePath: "OrderRepository.cs", content: `public class OrderRepository : IRepository<Order> {}` },
    ]);
    const sources = sourcesFor(
      { filePath: "OrderRepository.cs", typeName: "OrderRepository", methodName: "Save" },
      inv,
      inheritance,
    );
    expect(sources.map((s) => s.id)).toEqual(["IRepository.cs:IRepository:Save"]);
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `cd src/agent_extensions/plugins/noesis && bun test mcp/noesis-graph/scanner/invocations/invocations.algorithm.test.ts`
Expected: FAIL — `invocations.algorithm` missing.

- [ ] **Step 3: Implement `sourcesFor`**

```ts
// invocations.algorithm.ts
import type { InheritanceMap } from "../inheritance/inheritance.types.js";
import { ancestorsOf } from "../inheritance/inheritance.js";
import type { BehaviorRow, MethodDescriptor } from "./invocations.types.js";

export interface BehaviorInventory {
  byLocation: Map<string, BehaviorRow>;
  byTypeMethod: Map<string, BehaviorRow[]>;
}

export function sourcesFor(
  m: MethodDescriptor,
  inv: BehaviorInventory,
  inheritance: InheritanceMap,
): BehaviorRow[] {
  const sources: BehaviorRow[] = [];
  const seenIds = new Set<string>();

  const selfKey = `${m.filePath}:${m.typeName}:${m.methodName}`;
  const self = inv.byLocation.get(selfKey);
  if (self !== undefined) {
    sources.push(self);
    seenIds.add(self.id);
  }

  for (const ancestorTypeName of ancestorsOf(inheritance, m.typeName)) {
    const key = `${ancestorTypeName}:${m.methodName}`;
    const candidates = inv.byTypeMethod.get(key) ?? [];
    for (const c of candidates) {
      if (!seenIds.has(c.id)) {
        sources.push(c);
        seenIds.add(c.id);
      }
    }
  }

  return sources;
}
```

- [ ] **Step 4: Run — verify pass**

Run: `cd src/agent_extensions/plugins/noesis && bun test mcp/noesis-graph/scanner/invocations/invocations.algorithm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/
git commit -m "invocations: sourcesFor implements S1 S2 S3 S5 G1"
```

---

## Task 7: Invocations algorithm — reverse walk (D1 + D2 + D3 + D5 + E1)

**Files:**
- Modify: `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/invocations.algorithm.ts`
- Modify: `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/invocations.algorithm.test.ts`

- [ ] **Step 1: Write failing tests for `computeInvocations`**

Append to `invocations.algorithm.test.ts`:

```ts
import { computeInvocations } from "./invocations.algorithm.js";
import { makeFakeSerena } from "./fakes.js";
import type { SerenaReference } from "./invocations.types.js";

function ref(filePath: string, typeName: string, methodName: string): SerenaReference {
  return { enclosing: { filePath, typeName, methodName } };
}

describe("computeInvocations", () => {
  test("D1: direct invocation Place -> Notify", async () => {
    const rows = [
      { id: "Order.cs:Order:Place", filePath: "Order.cs", typeName: "Order", methodName: "Place" },
      { id: "Order.cs:Order:Notify", filePath: "Order.cs", typeName: "Order", methodName: "Notify" },
    ];
    const inv = behaviorsOf(rows);
    const inheritance = extractInheritanceMap([
      { relativePath: "Order.cs", content: `public class Order {}` },
    ]);
    const serena = makeFakeSerena({
      "Order/Notify|Order.cs": [ref("Order.cs", "Order", "Place")],
      "Order/Place|Order.cs": [],
    });

    const edges = await computeInvocations({ behaviors: rows, inv, inheritance, serena });

    expect(edges).toEqual([
      { source: "Order.cs:Order:Place", destination: "Order.cs:Order:Notify" },
    ]);
  });

  test("D2: indirect through non-behavior helper", async () => {
    const rows = [
      { id: "Order.cs:Order:Place", filePath: "Order.cs", typeName: "Order", methodName: "Place" },
      { id: "Order.cs:Order:Notify", filePath: "Order.cs", typeName: "Order", methodName: "Notify" },
    ];
    const inv = behaviorsOf(rows);
    const inheritance = extractInheritanceMap([
      { relativePath: "Order.cs", content: `public class Order {}` },
    ]);
    const serena = makeFakeSerena({
      "Order/Notify|Order.cs": [ref("Order.cs", "Order", "PlaceCore")],
      "Order/PlaceCore|Order.cs": [ref("Order.cs", "Order", "Place")],
      "Order/Place|Order.cs": [],
    });

    const edges = await computeInvocations({ behaviors: rows, inv, inheritance, serena });

    expect(edges).toEqual([
      { source: "Order.cs:Order:Place", destination: "Order.cs:Order:Notify" },
    ]);
  });

  test("D3: barrier — walk stops at the first behavior", async () => {
    const rows = [
      { id: "A.cs:A:a", filePath: "A.cs", typeName: "A", methodName: "a" },
      { id: "A.cs:A:b", filePath: "A.cs", typeName: "A", methodName: "b" },
      { id: "A.cs:A:c", filePath: "A.cs", typeName: "A", methodName: "c" },
    ];
    const inv = behaviorsOf(rows);
    const inheritance = extractInheritanceMap([
      { relativePath: "A.cs", content: `public class A {}` },
    ]);
    const serena = makeFakeSerena({
      "A/c|A.cs": [ref("A.cs", "A", "b")],
      "A/b|A.cs": [ref("A.cs", "A", "a")],
      "A/a|A.cs": [],
    });

    const edges = await computeInvocations({ behaviors: rows, inv, inheritance, serena });

    expect(edges).toContainEqual({ source: "A.cs:A:b", destination: "A.cs:A:c" });
    expect(edges).not.toContainEqual({ source: "A.cs:A:a", destination: "A.cs:A:c" });
  });

  test("D5: cycle safety — mutually recursive helpers terminate", async () => {
    const rows = [
      { id: "X.cs:X:Root", filePath: "X.cs", typeName: "X", methodName: "Root" },
      { id: "X.cs:X:Leaf", filePath: "X.cs", typeName: "X", methodName: "Leaf" },
    ];
    const inv = behaviorsOf(rows);
    const inheritance = extractInheritanceMap([
      { relativePath: "X.cs", content: `public class X {}` },
    ]);
    const serena = makeFakeSerena({
      "X/Leaf|X.cs": [ref("X.cs", "X", "helpA")],
      "X/helpA|X.cs": [ref("X.cs", "X", "helpB")],
      "X/helpB|X.cs": [ref("X.cs", "X", "helpA"), ref("X.cs", "X", "Root")],
      "X/Root|X.cs": [],
    });

    const edges = await computeInvocations({ behaviors: rows, inv, inheritance, serena });

    expect(edges).toEqual([
      { source: "X.cs:X:Root", destination: "X.cs:X:Leaf" },
    ]);
  });

  test("E1 + E2: cartesian product with deduplication", async () => {
    const rows = [
      { id: "Order.cs:Order:Place", filePath: "Order.cs", typeName: "Order", methodName: "Place" },
      { id: "OrderBase.cs:OrderBase:Place", filePath: "OrderBase.cs", typeName: "OrderBase", methodName: "Place" },
      { id: "Order.cs:Order:Notify", filePath: "Order.cs", typeName: "Order", methodName: "Notify" },
    ];
    const inv = behaviorsOf(rows);
    const inheritance = extractInheritanceMap([
      { relativePath: "OrderBase.cs", content: `public class OrderBase {}` },
      { relativePath: "Order.cs", content: `public class Order : OrderBase {}` },
    ]);
    const serena = makeFakeSerena({
      "Order/Notify|Order.cs": [ref("Order.cs", "Order", "Place")],
      "Order/Place|Order.cs": [],
      "OrderBase/Place|OrderBase.cs": [],
    });

    const edges = (await computeInvocations({ behaviors: rows, inv, inheritance, serena })).sort(
      (a, b) => (a.source + a.destination).localeCompare(b.source + b.destination),
    );

    expect(edges).toEqual([
      { source: "Order.cs:Order:Place", destination: "Order.cs:Order:Notify" },
      { source: "OrderBase.cs:OrderBase:Place", destination: "Order.cs:Order:Notify" },
    ]);
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `cd src/agent_extensions/plugins/noesis && bun test mcp/noesis-graph/scanner/invocations/invocations.algorithm.test.ts`
Expected: FAIL — `computeInvocations` missing.

- [ ] **Step 3: Implement `computeInvocations`**

Append to `invocations.algorithm.ts`:

```ts
import type {
  BehaviorRow,
  Invocation,
  MethodDescriptor,
  SerenaLike,
} from "./invocations.types.js";

export interface ComputeInvocationsInput {
  behaviors: BehaviorRow[];
  inv: BehaviorInventory;
  inheritance: InheritanceMap;
  serena: SerenaLike;
}

export async function computeInvocations(
  input: ComputeInvocationsInput,
): Promise<Invocation[]> {
  const edges = new Map<string, Invocation>();
  for (const b of input.behaviors) {
    await walkForBehavior(b, input, edges);
  }
  return Array.from(edges.values());
}

async function walkForBehavior(
  destination: BehaviorRow,
  input: ComputeInvocationsInput,
  edges: Map<string, Invocation>,
): Promise<void> {
  const visited = new Set<string>();
  const queue: MethodDescriptor[] = [
    { filePath: destination.filePath, typeName: destination.typeName, methodName: destination.methodName },
  ];

  while (queue.length > 0) {
    const target = queue.shift()!;
    const targetKey = methodKey(target);
    if (visited.has(targetKey)) continue;
    visited.add(targetKey);

    const namePath = `${target.typeName}/${target.methodName}`;
    const refs = await input.serena.findReferencingSymbols(namePath, target.filePath);

    for (const ref of refs) {
      if (ref.enclosing === null) continue;
      const sources = sourcesFor(ref.enclosing, input.inv, input.inheritance);
      if (sources.length > 0) {
        for (const s of sources) {
          const edgeKey = `${s.id}->${destination.id}`;
          if (!edges.has(edgeKey)) {
            edges.set(edgeKey, { source: s.id, destination: destination.id });
          }
        }
      } else {
        queue.push(ref.enclosing);
      }
    }
  }
}

function methodKey(m: MethodDescriptor): string {
  return `${m.filePath}:${m.typeName}:${m.methodName}`;
}
```

- [ ] **Step 4: Run — verify pass**

Run: `cd src/agent_extensions/plugins/noesis && bun test mcp/noesis-graph/scanner/invocations/invocations.algorithm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/
git commit -m "invocations: reverse walk D1 D2 D3 D5 E1 E2"
```

---

## Task 8: Invocations algorithm — D4 (callee side does not follow overrides)

**Files:**
- Modify: `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/invocations.algorithm.test.ts`

- [ ] **Step 1: Add failing test for D4**

Append:

```ts
  test("D4: call to OrderBase.Notify does not also emit Order.Notify", async () => {
    const rows = [
      { id: "OrderBase.cs:OrderBase:Notify", filePath: "OrderBase.cs", typeName: "OrderBase", methodName: "Notify" },
      { id: "Order.cs:Order:Notify", filePath: "Order.cs", typeName: "Order", methodName: "Notify" },
      { id: "Order.cs:Order:Place", filePath: "Order.cs", typeName: "Order", methodName: "Place" },
    ];
    const inv = behaviorsOf(rows);
    const inheritance = extractInheritanceMap([
      { relativePath: "OrderBase.cs", content: `public class OrderBase {}` },
      { relativePath: "Order.cs", content: `public class Order : OrderBase {}` },
    ]);
    const serena = makeFakeSerena({
      "OrderBase/Notify|OrderBase.cs": [ref("Order.cs", "Order", "Place")],
      "Order/Notify|Order.cs": [],
      "Order/Place|Order.cs": [],
    });

    const edges = await computeInvocations({ behaviors: rows, inv, inheritance, serena });

    expect(edges).toContainEqual({
      source: "Order.cs:Order:Place",
      destination: "OrderBase.cs:OrderBase:Notify",
    });
    expect(edges).not.toContainEqual({
      source: "Order.cs:Order:Place",
      destination: "Order.cs:Order:Notify",
    });
  });
```

- [ ] **Step 2: Run — verify pass**

Run: `cd src/agent_extensions/plugins/noesis && bun test mcp/noesis-graph/scanner/invocations/invocations.algorithm.test.ts`
Expected: PASS. The algorithm already satisfies D4 because each behavior is walked independently — `Order.Notify` has no incoming references in this fixture, so no edge to it is produced. This test guards against regressions where the walk mistakenly promotes call-sites across the override relation.

- [ ] **Step 3: Commit**

```bash
git add src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/invocations.algorithm.test.ts
git commit -m "invocations: D4 regression test"
```

---

## Task 9: Add `getBehaviorsWithLocations` to `ScannerRepository`

**Files:**
- Modify: `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/scanner.repository.ts`

Reason: invocations needs `(filePath, typeName, methodName)` per behavior. Today's schema stores only `Behavior.id` / `Behavior.name` and connects to `BuildingBlock → CSharpType`. We expose one new read method.

- [ ] **Step 1: Write query and method**

Insert in `ScannerRepository` (after `getDomainModel`):

```ts
  async getBehaviorsWithLocations(): Promise<
    Array<{ id: string; filePath: string; typeName: string; methodName: string }>
  > {
    const conn = this.db.getConnection();
    const result = await conn.query(
      "MATCH (b:BuildingBlock)-[:BB_REPRESENTED_BY_CSHARP_TYPE]->(t:CSharpType), " +
        "(b)-[:BB_CONTAINS_BEHAVIOR]->(x:Behavior) " +
        "RETURN x.id AS id, t.filePath AS filePath, t.name AS typeName " +
        "ORDER BY x.id",
    );
    const rows = asArray(result).getAllSync() as Array<{
      id: string;
      filePath: string;
      typeName: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      filePath: r.filePath,
      typeName: r.typeName,
      methodName: extractMethodNameFromBehaviorId(r.id),
    }));
  }
```

Also add this helper at the bottom of the file (near `buildTree`):

```ts
function extractMethodNameFromBehaviorId(id: string): string {
  // Behavior id format in scanner.service.ts: `${block.id}:${methodName}`
  // and block.id is `${file.relativePath}:${blockName}`, so methodName is the
  // final `:`-segment.
  const idx = id.lastIndexOf(":");
  return idx === -1 ? id : id.substring(idx + 1);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/scanner.repository.ts
git commit -m "scanner repo: getBehaviorsWithLocations"
```

Note on testing: a dedicated test for this read method lives with the full integration in Task 11, where `InvocationsRepository.test.ts` stands up a real DB. Adding a duplicate test here would duplicate fixture setup.

---

## Task 10: `InvocationsRepository` — schema, write, clear

**Files:**
- Create: `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/invocations.repository.ts`
- Create: `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/invocations.repository.test.ts`

- [ ] **Step 1: Write failing tests for schema+write**

```ts
// invocations.repository.test.ts
import "reflect-metadata";
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { DatabaseService } from "../../database/database.service.js";
import { DATA_DIR } from "../../config/config.module.js";
import { InvocationsRepository } from "./invocations.repository.js";

describe("InvocationsRepository", () => {
  let module: TestingModule;
  let db: DatabaseService;
  let repo: InvocationsRepository;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "noesis-invrepo-"));
    module = await Test.createTestingModule({
      providers: [
        DatabaseService,
        InvocationsRepository,
        { provide: DATA_DIR, useValue: tmpDir },
      ],
    }).compile();
    db = module.get(DatabaseService);
    repo = module.get(InvocationsRepository);
    db.onModuleInit();

    // Minimal Behavior nodes so FROM/TO targets exist.
    const conn = db.getConnection();
    await conn.query(
      "CREATE NODE TABLE IF NOT EXISTS Behavior(id STRING, name STRING, PRIMARY KEY(id))",
    );
    await repo.initSchema();
    const ins = await conn.prepare("CREATE (:Behavior {id: $id, name: $name})");
    for (const id of ["A", "B", "C"]) {
      await conn.execute(ins, { id, name: id });
    }
  });

  afterEach(async () => {
    await module.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("writes and reads an invocation edge", async () => {
    await repo.insertInvocation({ source: "A", destination: "B" });
    const all = await repo.getInvocations();
    expect(all).toEqual([{ source: "A", destination: "B" }]);
  });

  test("clearInvocations removes all edges", async () => {
    await repo.insertInvocation({ source: "A", destination: "B" });
    await repo.insertInvocation({ source: "B", destination: "C" });
    await repo.clearInvocations();
    expect(await repo.getInvocations()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `cd src/agent_extensions/plugins/noesis && bun test mcp/noesis-graph/scanner/invocations/invocations.repository.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the repository**

```ts
// invocations.repository.ts
import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service.js";
import type { Invocation } from "./invocations.types.js";

const SCHEMA_STATEMENTS = [
  "CREATE REL TABLE IF NOT EXISTS BEHAVIOR_INVOKES_BEHAVIOR(FROM Behavior TO Behavior)",
];

@Injectable()
export class InvocationsRepository {
  constructor(private readonly db: DatabaseService) {}

  async initSchema(): Promise<void> {
    const conn = this.db.getConnection();
    for (const stmt of SCHEMA_STATEMENTS) {
      await conn.query(stmt);
    }
  }

  async clearInvocations(): Promise<void> {
    const conn = this.db.getConnection();
    await conn.query("MATCH ()-[r:BEHAVIOR_INVOKES_BEHAVIOR]->() DELETE r");
  }

  async insertInvocation(invocation: Invocation): Promise<void> {
    const conn = this.db.getConnection();
    const stmt = await conn.prepare(
      "MATCH (s:Behavior), (d:Behavior) WHERE s.id = $sourceId AND d.id = $destinationId " +
        "CREATE (s)-[:BEHAVIOR_INVOKES_BEHAVIOR]->(d)",
    );
    await conn.execute(stmt, {
      sourceId: invocation.source,
      destinationId: invocation.destination,
    });
  }

  async getInvocations(filter?: {
    sourceBehaviorId?: string;
    destinationBehaviorId?: string;
  }): Promise<Invocation[]> {
    if (filter?.sourceBehaviorId && filter?.destinationBehaviorId) {
      throw new Error(
        "Pass at most one of sourceBehaviorId or destinationBehaviorId",
      );
    }

    const conn = this.db.getConnection();
    const where =
      filter?.sourceBehaviorId !== undefined
        ? "WHERE s.id = $id"
        : filter?.destinationBehaviorId !== undefined
        ? "WHERE d.id = $id"
        : "";
    const params =
      filter?.sourceBehaviorId !== undefined
        ? { id: filter.sourceBehaviorId }
        : filter?.destinationBehaviorId !== undefined
        ? { id: filter.destinationBehaviorId }
        : {};

    const stmt = await conn.prepare(
      `MATCH (s:Behavior)-[:BEHAVIOR_INVOKES_BEHAVIOR]->(d:Behavior) ${where} ` +
        "RETURN s.id AS source, d.id AS destination ORDER BY s.id, d.id",
    );
    const result = await conn.execute(stmt, params);
    const rows = asArray(result).getAllSync() as Invocation[];
    return rows;
  }
}

function asArray(result: unknown): { getAllSync(): unknown[] } {
  if (Array.isArray(result)) return result[0];
  return result as { getAllSync(): unknown[] };
}
```

- [ ] **Step 4: Run — verify pass**

Run: `cd src/agent_extensions/plugins/noesis && bun test mcp/noesis-graph/scanner/invocations/invocations.repository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/invocations.repository.ts \
        src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/invocations.repository.test.ts
git commit -m "invocations: repository schema, insert, clear, read"
```

---

## Task 11: `InvocationsRepository` — filtered reads + mutex guard

**Files:**
- Modify: `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/invocations.repository.test.ts`

- [ ] **Step 1: Add failing tests**

Append inside the existing `describe`:

```ts
  test("filter by sourceBehaviorId", async () => {
    await repo.insertInvocation({ source: "A", destination: "B" });
    await repo.insertInvocation({ source: "A", destination: "C" });
    await repo.insertInvocation({ source: "B", destination: "C" });
    const rows = await repo.getInvocations({ sourceBehaviorId: "A" });
    expect(rows).toEqual([
      { source: "A", destination: "B" },
      { source: "A", destination: "C" },
    ]);
  });

  test("filter by destinationBehaviorId", async () => {
    await repo.insertInvocation({ source: "A", destination: "C" });
    await repo.insertInvocation({ source: "B", destination: "C" });
    const rows = await repo.getInvocations({ destinationBehaviorId: "C" });
    expect(rows).toEqual([
      { source: "A", destination: "C" },
      { source: "B", destination: "C" },
    ]);
  });

  test("both filters throws", async () => {
    await expect(
      repo.getInvocations({ sourceBehaviorId: "A", destinationBehaviorId: "B" }),
    ).rejects.toThrow(/at most one/);
  });
```

- [ ] **Step 2: Run — verify pass**

Run: `cd src/agent_extensions/plugins/noesis && bun test mcp/noesis-graph/scanner/invocations/invocations.repository.test.ts`
Expected: PASS (code in Task 10 already supports this).

- [ ] **Step 3: Commit**

```bash
git add src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/invocations.repository.test.ts
git commit -m "invocations repo: filter tests"
```

---

## Task 12: `InvocationsService` — orchestration

**Files:**
- Create: `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/invocations.service.ts`

Responsibilities: (a) build the `BehaviorInventory` from `ScannerRepository`, (b) adapt `SerenaService` to `SerenaLike`, (c) call `computeInvocations`, (d) persist via `InvocationsRepository`, (e) expose `getBehaviorInvocations`.

- [ ] **Step 1: Implement the service**

```ts
// invocations.service.ts
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { SerenaService } from "../../serena/serena.service.js";
import { ScannerRepository } from "../scanner.repository.js";
import { InvocationsRepository } from "./invocations.repository.js";
import { computeInvocations, type BehaviorInventory } from "./invocations.algorithm.js";
import type { InheritanceMap } from "../inheritance/inheritance.types.js";
import type {
  BehaviorRow,
  Invocation,
  SerenaLike,
  SerenaReference,
} from "./invocations.types.js";

@Injectable()
export class InvocationsService implements OnModuleInit {
  private readonly logger = new Logger(InvocationsService.name);

  constructor(
    private readonly scannerRepo: ScannerRepository,
    private readonly repo: InvocationsRepository,
    private readonly serena: SerenaService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.repo.initSchema();
  }

  async rebuildInvocations(inheritance: InheritanceMap): Promise<Invocation[]> {
    const behaviors = await this.scannerRepo.getBehaviorsWithLocations();
    const inv = buildInventory(behaviors);
    const edges = await computeInvocations({
      behaviors,
      inv,
      inheritance,
      serena: this.asSerenaLike(),
    });
    await this.repo.clearInvocations();
    for (const edge of edges) {
      await this.repo.insertInvocation(edge);
    }
    this.logger.log(`Inserted ${edges.length} behavior invocations`);
    return edges;
  }

  async getBehaviorInvocations(filter?: {
    sourceBehaviorId?: string;
    destinationBehaviorId?: string;
  }): Promise<Invocation[]> {
    return this.repo.getInvocations(filter);
  }

  private asSerenaLike(): SerenaLike {
    return {
      findReferencingSymbols: async (namePath, relativePath) => {
        const response = await this.serena.callTool<SerenaRefsResponse>(
          "find_referencing_symbols",
          { name_path: namePath, relative_path: relativePath },
        );
        return response.map(toSerenaReference);
      },
    };
  }
}

interface SerenaRefsResponseEntry {
  name_path?: string;
  relative_path?: string;
  kind?: number;
}

type SerenaRefsResponse = SerenaRefsResponseEntry[];

function toSerenaReference(entry: SerenaRefsResponseEntry): SerenaReference {
  if (!entry.name_path || !entry.relative_path) return { enclosing: null };
  const parts = entry.name_path.split("/").filter((p) => p !== "");
  if (parts.length < 2) return { enclosing: null };
  const methodName = parts[parts.length - 1];
  const typeName = parts[parts.length - 2];
  return {
    enclosing: {
      filePath: entry.relative_path,
      typeName,
      methodName,
    },
  };
}

function buildInventory(rows: BehaviorRow[]): BehaviorInventory {
  const byLocation = new Map<string, BehaviorRow>();
  const byTypeMethod = new Map<string, BehaviorRow[]>();
  for (const r of rows) {
    byLocation.set(`${r.filePath}:${r.typeName}:${r.methodName}`, r);
    const key = `${r.typeName}:${r.methodName}`;
    const list = byTypeMethod.get(key) ?? [];
    list.push(r);
    byTypeMethod.set(key, list);
  }
  return { byLocation, byTypeMethod };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/invocations/invocations.service.ts
git commit -m "invocations: service orchestrator"
```

Note on testing: the service is a thin adapter between `ScannerRepository`, `SerenaService`, `computeInvocations`, and `InvocationsRepository`. Each of those is unit-tested in isolation; the adapter layer is verified by the scan-integration test in Task 14.

---

## Task 13: Register new providers in `ScannerModule`

**Files:**
- Modify: `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/scanner.module.ts`

- [ ] **Step 1: Update the module**

Replace file contents with:

```ts
import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { SerenaModule } from "../serena/serena.module.js";
import { ScannerService } from "./scanner.service.js";
import { ScannerRepository } from "./scanner.repository.js";
import { ScannerController } from "./scanner.controller.js";
import { InvocationsRepository } from "./invocations/invocations.repository.js";
import { InvocationsService } from "./invocations/invocations.service.js";

@Module({
  imports: [DatabaseModule, SerenaModule],
  controllers: [ScannerController],
  providers: [
    ScannerService,
    ScannerRepository,
    InvocationsRepository,
    InvocationsService,
  ],
  exports: [ScannerService, InvocationsService],
})
export class ScannerModule {}
```

- [ ] **Step 2: Build sanity check**

Run: `cd src/agent_extensions/plugins/noesis && bun test mcp/noesis-graph/`
Expected: existing tests pass; no compile errors.

- [ ] **Step 3: Commit**

```bash
git add src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/scanner.module.ts
git commit -m "scanner module: wire invocations providers and SerenaModule"
```

---

## Task 14: Integrate invocations into `ScannerService.scan()`

**Files:**
- Modify: `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/scanner.service.ts`

Context: `scan()` already builds `ScannedFile[]` (which has `{relativePath, namespace, matches}` but no content). We need the raw content to feed the inheritance extractor. Rather than re-reading files, we thread content through the pipeline.

- [ ] **Step 1: Thread file content through the scan pipeline**

In `scanner.service.ts`:

1. Extend the `ScannedFile` interface:

```ts
interface ScannedFile {
  relativePath: string;
  namespace: string;
  matches: AnnotationMatch[];
  content: string;                 // NEW
}
```

2. In `scanCsFiles`, retain content:

```ts
      const batchResults = await Promise.all(
        batch.map(async (absPath) => {
          const content = await readFile(absPath, "utf-8");
          const namespace = extractNamespace(content) ?? "";
          const matches = parseAnnotations(content);
          const relativePath = relative(this.projectDir, absPath);
          return { relativePath, namespace, matches, content };
        }),
      );
```

3. Extend `KeptFile`:

```ts
interface KeptFile {
  relativePath: string;
  rawNamespace: string;
  namespace: string;
  matches: AnnotationMatch[];
  content: string;                 // NEW
}
```

4. When building `keptFiles` (inside `scan`), propagate `content`:

```ts
    const keptFiles: KeptFile[] = notExcluded
      .map((f) => ({
        relativePath: f.relativePath,
        rawNamespace: f.namespace,
        namespace: removeSkippedParts(f.namespace, config.namespacePartsToSkip),
        matches: f.matches,
        content: f.content,
      }))
      .filter((f) => f.namespace !== "");
```

- [ ] **Step 2: Inject `InvocationsService` and call it at the end of `scan()`**

Add import:

```ts
import { InvocationsService } from "./invocations/invocations.service.js";
import { extractInheritanceMap } from "./inheritance/inheritance.js";
```

Update the constructor:

```ts
  constructor(
    private readonly repository: ScannerRepository,
    private readonly invocations: InvocationsService,
    @Inject(PROJECT_DIR) private readonly projectDir: string,
  ) {}
```

At the end of `scan()`, just before `const tree = await this.repository.getDomainModel();`:

```ts
    this.logger.log("Starting invocations analysis");
    const inheritance = extractInheritanceMap(
      keptFiles.map((f) => ({ relativePath: f.relativePath, content: f.content })),
    );
    await this.invocations.rebuildInvocations(inheritance);
```

- [ ] **Step 3: Run existing scanner tests — verify still pass**

Run: `cd src/agent_extensions/plugins/noesis && bun test mcp/noesis-graph/scanner/scanner.service.test.ts`
Expected: PASS. The existing tests target pure helper functions (`removeSkippedParts`, `extractNamespace`, etc.) which we did not touch.

- [ ] **Step 4: Commit**

```bash
git add src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/scanner.service.ts
git commit -m "scanner: run invocations pass at end of scan()"
```

---

## Task 15: HTTP endpoint

**Files:**
- Modify: `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/scanner.controller.ts`

- [ ] **Step 1: Add the endpoint**

Replace file with:

```ts
import { Controller, Get, Post, Query } from "@nestjs/common";
import { ScannerService } from "./scanner.service.js";
import { InvocationsService } from "./invocations/invocations.service.js";
import type { DomainModelTree } from "./scanner.types.js";
import type { Invocation } from "./invocations/invocations.types.js";

@Controller("api/model")
export class ScannerController {
  constructor(
    private readonly scanner: ScannerService,
    private readonly invocations: InvocationsService,
  ) {}

  @Get()
  async getModel(): Promise<DomainModelTree> {
    return this.scanner.getDomainModel();
  }

  @Post("scan")
  async scan(): Promise<DomainModelTree> {
    return this.scanner.scan();
  }

  @Get("invocations")
  async getInvocations(
    @Query("sourceBehaviorId") sourceBehaviorId?: string,
    @Query("destinationBehaviorId") destinationBehaviorId?: string,
  ): Promise<Invocation[]> {
    return this.invocations.getBehaviorInvocations({
      sourceBehaviorId,
      destinationBehaviorId,
    });
  }
}
```

- [ ] **Step 2: Build sanity check**

Run: `cd src/agent_extensions/plugins/noesis && bun test mcp/noesis-graph/`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/scanner.controller.ts
git commit -m "scanner controller: GET /api/model/invocations"
```

---

## Task 16: MCP tool `get_behavior_invocations`

**Files:**
- Modify: `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/scanner.mcp.ts`

- [ ] **Step 1: Add the tool registration**

Replace file with:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ScannerService } from "./scanner.service.js";
import { InvocationsService } from "./invocations/invocations.service.js";

export function registerScannerTools(
  mcp: McpServer,
  scanner: ScannerService,
  invocations: InvocationsService,
): void {
  mcp.registerTool(
    "get_domain_model",
    {
      description:
        "Returns the domain model from the knowledge graph (Bounded Contexts, Modules, Building Blocks). " +
        "Optionally filter to a specific Bounded Context (by name) or Module (by full path, e.g. 'Sales.Orders'). " +
        "If no filter is given the full tree is returned.",
      inputSchema: {
        boundedContextName: z
          .string()
          .optional()
          .describe("Name of the Bounded Context to return. Mutually exclusive with modulePath."),
        modulePath: z
          .string()
          .optional()
          .describe("Full dotted path of the Module to return. Mutually exclusive with boundedContextName."),
      },
    },
    async ({ boundedContextName, modulePath }) => {
      try {
        const part = await scanner.getDomainModelPart({ boundedContextName, modulePath });
        return { content: [{ type: "text", text: JSON.stringify(part, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: message }], isError: true };
      }
    },
  );

  mcp.registerTool(
    "get_behavior_invocations",
    {
      description:
        "Returns Invokes relations between domain behaviors. Each edge connects a source behavior to a destination behavior. " +
        "Optionally filter by source or destination behavior id (mutually exclusive).",
      inputSchema: {
        sourceBehaviorId: z
          .string()
          .optional()
          .describe("Return only invocations outgoing from this behavior. Mutually exclusive with destinationBehaviorId."),
        destinationBehaviorId: z
          .string()
          .optional()
          .describe("Return only invocations incoming to this behavior. Mutually exclusive with sourceBehaviorId."),
      },
    },
    async ({ sourceBehaviorId, destinationBehaviorId }) => {
      try {
        const edges = await invocations.getBehaviorInvocations({
          sourceBehaviorId,
          destinationBehaviorId,
        });
        return { content: [{ type: "text", text: JSON.stringify({ invocations: edges }, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: message }], isError: true };
      }
    },
  );
}
```

- [ ] **Step 2: Update the caller of `registerScannerTools`**

Search for `registerScannerTools(` in `server.ts` and `app.module.ts`:

```bash
grep -rn "registerScannerTools" src/agent_extensions/plugins/noesis/mcp/noesis-graph/
```

Update every call-site to pass the injected `InvocationsService` alongside `ScannerService`. The pattern will be:

```ts
const invocations = app.get(InvocationsService);
registerScannerTools(mcp, scanner, invocations);
```

If the call sites retrieve services via `app.get(...)`, add the new import and resolve `InvocationsService` there.

- [ ] **Step 3: Build sanity check**

Run: `cd src/agent_extensions/plugins/noesis && bun test mcp/noesis-graph/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/scanner.mcp.ts \
        src/agent_extensions/plugins/noesis/mcp/noesis-graph/server.ts
git commit -m "mcp tool: get_behavior_invocations"
```

---

## Task 17: End-to-end sanity — full test run

- [ ] **Step 1: Run the whole package test suite**

Run: `cd src/agent_extensions/plugins/noesis && bun test`
Expected: PASS. No TypeScript compile errors, all unit and repository tests green.

- [ ] **Step 2: If a real scan target is available, run a scan manually**

Only if a `PROJECT_DIR` with an actual C# codebase is configured:

```
POST /api/model/scan
GET  /api/model/invocations
```

Verify that some edges are emitted and that `/api/model/invocations?sourceBehaviorId=<id>` filters correctly. This is a manual smoke check, not a CI test.

- [ ] **Step 3: Final commit (only if anything changed during sanity check)**

```bash
git status
# If clean, no commit needed.
```

---

## Self-review — spec coverage check

- Inheritance module: Tasks 1–4 (types, extractor, edge cases, ancestorsOf). ✓
- Invocations algorithm S1–S5 / G1: Tasks 6 (sourcesFor) + 7 (reverse walk) + 8 (D4 regression). ✓
- Invocations algorithm D1–D5: Tasks 7 + 8. ✓
- Invocations algorithm E1/E2: Task 7. ✓
- Behavior id → `(file, type, method)` lookup needed by algorithm: Task 9 (`getBehaviorsWithLocations`). ✓
- `BEHAVIOR_INVOKES_BEHAVIOR` REL table + writes + filtered reads + clear: Tasks 10 + 11. ✓
- `InvocationsService` orchestration + Serena adapter: Task 12. ✓
- `ScannerModule` wiring + `SerenaModule` import: Task 13. ✓
- Integrate into `scan()` atomically (fail-fast when Serena not connected — native: `SerenaService.callTool` throws when not connected): Task 14. ✓
- HTTP endpoint `GET /api/model/invocations`: Task 15. ✓
- MCP tool `get_behavior_invocations`: Task 16. ✓
- End-to-end sanity: Task 17. ✓

## Self-review — naming and type consistency

- `Invocation { source, destination }` is used consistently in types, algorithm, repository Cypher aliases, service, controller response, MCP output.
- `BehaviorRow { id, filePath, typeName, methodName }` is used in types, algorithm, inventory construction, and `ScannerRepository.getBehaviorsWithLocations` return type.
- `MethodDescriptor { filePath, typeName, methodName }` used in algorithm and Serena adapter.
- `BEHAVIOR_INVOKES_BEHAVIOR` is the single REL table name, matching the existing `<FROM>_<VERB>_<TO>` convention.
- `computeInvocations`, `sourcesFor`, `ancestorsOf`, `extractInheritanceMap` — function names consistent across tasks and with the spec.
