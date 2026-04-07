# Phase 1: Domain Comprehension & Model Sketch

## Requirement Reading Strategy

Read the requirement looking specifically for:

1. **Nouns** → candidate entities and value objects
2. **Verbs and rules** → candidate behaviors and invariants
3. **Lifecycle language** ("created", "confirmed", "cancelled", "expired") → aggregate states and domain events
4. **Consistency language** ("must always", "cannot", "only when") → invariants and their scope
5. **Boundary signals** ("independently", "separately", "its own") → aggregate boundary hints

Do NOT try to map nouns directly to classes. First understand what changes together, what has identity, and what is just a descriptor.

## Targeted Codebase Scan

If the project has existing domain code, find it efficiently:

```bash
# Find existing domain/model directories
find . -type d -iname "*domain*" -o -iname "*model*" -o -iname "*entities*" -o -iname "*aggregates*" | head -20

# Find types mentioned in the requirement (grep for specific nouns)
grep -rl "class.*TypeName" --include="*.cs" src/ | head -10
```

From the scan, extract:
- Base classes or interfaces used for entities/aggregates/value objects
- Namespace pattern (e.g., `Company.Project.Domain.Aggregates.X`)
- Folder organization (flat vs nested by aggregate)
- Any existing types the new model must reference

Spend no more than 2-3 minutes on this. If you can't find existing domain code quickly, proceed with defaults from the idioms reference.

## Domain Model Sketch Format

The sketch is the primary artifact of Phase 1. It must make domain decisions explicit and reviewable before any code is written.

```
# Domain Model Sketch: [Name]

## Aggregates

### [AggregateName] (Aggregate Root)
  Identity: [how identified — surrogate ID, natural key, composite]
  Entities: [contained entities, if any]
  Value Objects: [contained value objects]
  Invariants:
    - [Rule 1: plain language description]
    - [Rule 2: plain language description]
  Key Behaviors:
    - [Method/action 1 — what it does, which invariant it enforces]
    - [Method/action 2]
  Emits: [DomainEvent1, DomainEvent2]
  References: [other aggregate IDs it holds — by ID only, not object]

### [AnotherAggregate] (Aggregate Root)
  ...

## Standalone Value Objects
  [Value objects shared across aggregates or used independently]
  - [ValueObject1]: [what it represents, equality semantics]

## Domain Services
  - [ServiceName]: coordinates [Aggregate1] and [Aggregate2] because [reason — rule that spans aggregates]

## Domain Events
  - [EventName]: emitted when [condition], carries [key data]

## Open Questions
  - [Anything unclear from the requirement that affects the model design]
```

### Sketch Quality Checks

Before presenting the sketch, verify:

- Every invariant is assigned to exactly one aggregate (no orphan rules)
- No aggregate references another aggregate by object — only by ID
- Every domain event has a clear trigger and at least one reason to exist
- Entities vs value objects are justified: entities have identity and lifecycle, value objects are compared by attributes
- No "God aggregate" that owns everything — if one aggregate has more than 5-6 value objects or 3 child entities, consider splitting
- Open Questions section captures genuine unknowns, not placeholder text
