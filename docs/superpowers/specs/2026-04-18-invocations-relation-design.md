# `Behavior.Invokes` — Scanner Support Design

Date: 2026-04-18
Scope: `src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/`

## Goal

Add support for the `Invokes` relation to the noesis-graph scanner, as
specified in
`src/agent_extensions/plugins/noesis/mcp/noesis-graph/scanner/InvokesBehavior.rules.md`.
The relation expresses that one domain behavior causes execution of another,
following the rules S1–S5, D1–D5, G1–G2, and E1–E2 defined there.

## Strategy

The scanner currently parses C# files with regex and persists domain-model
nodes in Kuzu. The `Invokes` rules require cross-file semantic resolution
(base method chains, interface members, generic definitions, forward traversal
through non-behavior helpers) that regex cannot do correctly.

The noesis-graph server already embeds **Serena** as an MCP client
(`scanner/serena/serena.service.ts`), specifically to provide semantic
analysis without a custom Roslyn tool. Serena's `find_referencing_symbols`
(incoming-reference direction, with enclosing-symbol info) is sufficient to
reverse-walk the call graph from every known behavior. For the source-side
rules S2/S3/G1 — where the calling method may be unannotated but its
interface member or base method is the domain behavior — Serena's non-JetBrains
toolset does not expose type-hierarchy or find-implementations primitives.
We therefore add a small **textual** extraction pass that captures
`class X : Base, IFoo` declarations (in-memory only; no graph persistence).

## Module layout

```
scanner/
├── scanner.service.ts            # existing; invokes new final phase in scan()
├── scanner.repository.ts         # existing; unchanged
├── scanner.types.ts              # existing
│
├── inheritance/                  # NEW — textual base/interface extractor
│   ├── inheritance.ts            # public: extractInheritanceMap(files) → InheritanceMap
│   ├── inheritance.test.ts
│   └── inheritance.types.ts
│
└── invocations/                  # NEW — Invokes relation computation + persistence
    ├── invocations.service.ts    # public: computeInvocations(...), getBehaviorInvocations(...)
    ├── invocations.service.test.ts
    ├── invocations.repository.ts # BEHAVIOR_INVOKES_BEHAVIOR schema + writes/reads
    ├── invocations.repository.test.ts
    ├── invocations.types.ts
    └── fakes.ts                  # test-only: makeFakeSerena(refsByKey)
```

Responsibilities:

- **`inheritance/`** is pure, stateless, textual. No Serena, no DB. Consumes
  pre-read C# file buffers, returns an `InheritanceMap` consumed once by
  `invocations.service.ts` and discarded.
- **`invocations/`** depends on three inputs: the behavior inventory (via
  `ScannerRepository`), the `InheritanceMap`, and `SerenaService`. It owns
  the `BEHAVIOR_INVOKES_BEHAVIOR` REL table and its read/write paths.
- **`scanner.service.ts`** gains one orchestration step at the end of `scan()`:
  build `InheritanceMap`, compute invocations, persist them. Fail-fast: if
  Serena is not connected, `scan()` throws (atomic scan).
- **MCP/API exposure** goes through `scanner.controller.ts` and
  `scanner.mcp.ts` (new endpoint and new MCP tool), delegating to
  `InvocationsService`.

## Inheritance extraction (`inheritance/`)

### Types

```ts
interface TypeHeader {
  typeId: string;                  // matches CSharpType.id from scanner.service.ts
  typeName: string;
  baseTypeNames: string[];         // textual, generics stripped
  interfaceTypeNames: string[];    // textual, generics stripped
  filePath: string;
}

interface InheritanceMap {
  byTypeId: Map<string, TypeHeader>;
  byTypeName: Map<string, TypeHeader[]>;
}
```

### Algorithm

For each kept file, a regex matches every top-level type declaration:

```
/\b(?:class|struct|interface|record)\s+(\w+)\s*(?:<[^>]*>)?\s*(?::\s*([^{]+))?\s*[{]/g
```

This captures:
- group 1: the type name.
- group 2: the raw post-colon fragment (empty if no inheritance clause).

Each comma-separated entry in group 2 is trimmed; generic-argument suffixes
(`<…>`) are stripped, implementing **G1** at the name level (e.g.
`IRepository<Order>` → `IRepository`).

Heuristic split: the first entry (when present) is reported as a base type,
the remainder as interfaces. For source-side rule resolution the two lists
are unioned into "ancestors"; the split is preserved only for debugging and
future use.

### What is deliberately out of scope

- No symbol-level binding (namespace-qualified names, `using` aliases,
  disambiguation of same-named types across namespaces). Name-based
  resolution is accurate enough for S2/S3 in a typical DDD layout.
- No persistence. The map is returned, consumed once, discarded.

### Tests (`inheritance.test.ts`)

- Single class with one base and two interfaces.
- Class with generic base (`IRepository<Order>`) → `IRepository` recorded.
- Class with no inheritance → empty arrays.
- Interface inheriting interfaces.
- Record and struct variants.
- File with multiple top-level types.
- Malformed or partial declarations are skipped without throwing.
- `byTypeName` returns a list when multiple files declare types with the
  same name.

## Invocations computation (`invocations/`)

### Inputs

Assembled once per `scan()` invocation:

- `behaviorsByLocation: Map<"${filePath}:${typeName}:${methodName}", Behavior>`
- `behaviorsByTypeMethod: Map<"${typeName}:${methodName}", Behavior[]>`
- `inheritance: InheritanceMap`
- `serena: SerenaService`

### `sourcesFor(m)`

Given an enclosing-method descriptor `m = { file, type, method }`, returns the
set of domain-behavior sources per rules S1/S2/S3/G1:

```
sources = []
// S1
if behaviorsByLocation has (m.file, m.type, m.method): add it
// S2 + S3 + G1
for ancestorTypeName in ancestorsOf(m.type, inheritance):
  for b in behaviorsByTypeMethod["{ancestorTypeName}:{m.method}"]:
    add b
return sources
```

`ancestorsOf(typeName, inheritance)` follows the asymmetry between S3 and S5
in the rules: the **class base chain** is walked transitively (S3), but
**interface inheritance is not traversed** (S5 — only directly-declared
interfaces of each type are inspected, never the parents of those
interfaces). Concretely:

```
ancestorsOf(typeName):
  result = []
  current = typeName
  seen = Set<string>
  while current in inheritance.byTypeName and current not in seen:
    seen.add(current)
    header = firstHeaderFor(current)
    // S2 / S5: include interfaces directly declared on `current`, no further walk
    for intfName in header.interfaceTypeNames: result.add(intfName)
    // S3: continue up the class base chain
    if header.baseTypeNames is non-empty:
      baseName = header.baseTypeNames[0]
      result.add(baseName)
      current = baseName
    else:
      break
  return result
```

This yields, for each class in the base chain, that class's directly-declared
interfaces, plus the class itself — never an interface's parent interface.

### Main reverse walk

For every behavior `B` in the inventory, walk backward from its defining
method's `name_path`:

```
invocations = Set<Invocation>
for each Behavior B in behavior inventory: walk(B)

function walk(B):
  visited = Set<MethodKey>
  queue = [ { file: B.file, namePath: "{B.type}/{B.methodName}" } ]
  while queue not empty:
    target = queue.pop()
    if target in visited: continue                     // D5
    visited.add(target)
    refs = serena.find_referencing_symbols(target.namePath, target.file)
    for ref in refs:
      enclosing = ref.enclosing_symbol_descriptor
      if not methodLike(enclosing): continue           // skip field initializers, etc.
      srcs = sourcesFor(enclosing)
      if srcs non-empty:
        for s in srcs: invocations.add({ source: s.id, destination: B.id })
        // D3: barrier — do not enqueue enclosing
      else:
        queue.push(enclosing)                          // D2
```

### Mapping to the rules

| Rule | Implementation |
| --- | --- |
| S1 | `sourcesFor` hits `behaviorsByLocation`. |
| S2 | Ancestor walk finds interface members of same name. |
| S3 | Ancestor walk finds base members of same name. |
| S4 | Reverse walk never descends to derived types. |
| S5 | `ancestorsOf` collects only directly-declared interfaces at each class-chain step; interface parents are never followed. |
| D1 | Direct references to `B` yield `enclosing → B`. |
| D2 | Non-behavior enclosing methods are enqueued; their references walked. |
| D3 | When `sourcesFor(enclosing)` returns behaviors, enclosing is *not* enqueued. |
| D4 | Serena's references return the literal target's call-sites only. |
| D5 | `visited` set. |
| E1/E2 | Each source × `B` pair added to `invocations` Set; deduped. |
| G1 | `InheritanceMap` strips generic args on ancestor names. |
| G2 | LSP references on a generic-definition method aggregate call-sites of all constructions. |

### Known fuzzy edges

- References whose enclosing symbol is not a method (field initializer,
  property initializer, constructor chain) are skipped. The rules do not
  specify behavior for these, and they are uncommon in DDD code.
- Same-named types across namespaces (e.g. two `Order` classes) are treated
  as a single type-name node in the inheritance map. False positives are
  narrow and acceptable for this iteration.

### Tests (`invocations.service.test.ts`)

Fake Serena + fake behavior inventory + hand-built inheritance map. Fake Serena
is a stub that returns prerecorded references per `(name_path, relative_path)`
pair, exposed from `invocations/fakes.ts`.

Test cases mirror the examples in `InvokesBehavior.rules.md`:

1. Direct invocation (D1).
2. Indirect via a non-behavior helper (D2).
3. Base class method as additional source (S3 + E2).
4. Interface member as source (S2).
5. Destination does not follow overrides (D4).
6. Generic-definition source (G1).
7. Cycle safety across mutually recursive helpers (D5).
8. Barrier — reverse walk stops at the first behavior on a path (D3).
9. Cartesian product with deduplication (E1).
10. Interface inheritance is not traversed (S5) — `IBase.Place` annotated,
    `IChild : IBase`, `Order : IChild` with `Order.Place` unannotated; a call
    from `Order.Place` must *not* emit `IBase.Place → …`.

## Graph schema and persistence

One new REL table owned by `InvocationsRepository`:

```
CREATE REL TABLE IF NOT EXISTS BEHAVIOR_INVOKES_BEHAVIOR(
  FROM Behavior TO Behavior
)
```

`InvocationsRepository.initSchema()` runs on module init. Before persisting a
fresh result, the repository explicitly clears its edges:

```
MATCH ()-[r:BEHAVIOR_INVOKES_BEHAVIOR]->() DELETE r
```

This is redundant when `scan()` has just run `ScannerRepository.clearModel()`
(`DETACH DELETE` on `Behavior` removes attached edges), but keeps the
invocations repository independent of the scanner's deletion order.

Writes (bulk, one prepared execute per invocation):

```
MATCH (s:Behavior), (d:Behavior)
WHERE s.id = $sourceId AND d.id = $destinationId
CREATE (s)-[:BEHAVIOR_INVOKES_BEHAVIOR]->(d)
```

Deduplication happens upstream in the `Set<Invocation>`, so `CREATE` semantics
are sufficient.

Reads:

```
MATCH (s:Behavior)-[:BEHAVIOR_INVOKES_BEHAVIOR]->(d:Behavior)
[optional WHERE s.id = $sourceId / d.id = $destinationId]
RETURN s.id AS source, d.id AS destination
ORDER BY s.id, d.id
```

The column aliases match the `Invocation` type (`{ source: BehaviorId,
destination: BehaviorId }`), so the repository returns already-shaped rows.

### Out of scope

- Edge metadata (call-site file/line, invocation count). The rules describe
  the existence of the relation, not its call-site density. Metadata can be
  added later as REL properties if a use case emerges.

## MCP / API exposure

### `InvocationsService` surface

```ts
getBehaviorInvocations(filter?: {
  sourceBehaviorId?: string;
  destinationBehaviorId?: string;
}): Promise<Invocation[]>
```

Mutually exclusive filters — passing both throws, following the defensive
pattern in `scanner.service.ts` (`getDomainModelPart`).

### HTTP endpoint (on `scanner.controller.ts`)

```
GET /api/scanner/invocations
GET /api/scanner/invocations?sourceBehaviorId=<id>
GET /api/scanner/invocations?destinationBehaviorId=<id>
```

Returns `Invocation[]`.

### MCP tool (in `scanner.mcp.ts`)

- Name: `get_behavior_invocations`
- Description: "Returns Invokes relations between domain behaviors. Optional
  filter by source or destination behavior id (mutually exclusive)."
- Input: `{ sourceBehaviorId?: string, destinationBehaviorId?: string }`,
  validated with Zod.
- Output: `{ invocations: Invocation[] }` where
  `Invocation = { source: BehaviorId, destination: BehaviorId }`.

### Not exposed here

- Transitive-closure queries — the Kuzu Cypher query language handles these
  client-side on the stored edges; the server does not precompute.
- Source/destination counts — derivable from the edge list.
- The `InheritanceMap` — strictly internal.

## Scan integration

`ScannerService.scan()` gets one appended phase:

1. (existing) Scan C# files.
2. (existing) Build bounded contexts, modules, types, building blocks,
   behaviors. Persist.
3. **(new)** Build `InheritanceMap` from the already-loaded file buffers.
4. **(new)** Call `InvocationsService.computeInvocations(inheritanceMap)`,
   which loads behaviors from the repository, reverse-walks via Serena, and
   persists `BEHAVIOR_INVOKES_BEHAVIOR` edges.
5. (existing) Return the `DomainModelTree`.

If Serena is not connected, step 4 throws and the scan fails atomically. No
graceful degradation — the model is either fully built or not at all.

## Testing summary

| Concern | Test file | Approach |
| --- | --- | --- |
| Inheritance textual pass | `inheritance/inheritance.test.ts` | Fixture strings, pure function. |
| Invocations algorithm | `invocations/invocations.service.test.ts` | Fake Serena + fixtures; covers every rule example. |
| Invocations persistence | `invocations/invocations.repository.test.ts` | Tmp Kuzu DB via `DatabaseService` (same pattern as existing repository tests). |

Real-Serena end-to-end coverage is deferred: a live C# fixture + LSP warmup is
expensive to set up in CI, and each layer above is unit-verifiable in
isolation. A gated integration test can be added later.

## Naming conventions honored

- Directories and files: `kebab-case`.
- REL table: `BEHAVIOR_INVOKES_BEHAVIOR`, matching existing
  `<FROM>_<VERB>_<TO>` convention (`BB_CONTAINS_BEHAVIOR`,
  `MODULE_CONTAINS_BB`, etc.).
- Service/repository class names: `InvocationsService`, `InvocationsRepository`.
- Types: `Invocation`, `TypeHeader`, `InheritanceMap`.
- All identifiers, comments, docs in English.
