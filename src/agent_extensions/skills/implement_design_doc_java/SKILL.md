---
name: Implement Design Doc (Java)
description: Implement or update Java domain model code based on a DesignDoc JSON contract. Use this skill whenever you need to translate a DesignDoc JSON (containing building blocks, bounded contexts, modules, use cases, rules, scenarios) into Java classes, or when you need to ensure existing Java code matches a DesignDoc specification. Triggers on any task involving DesignDoc JSON and Java code generation, Java domain model implementation from design specifications, or synchronizing Java code with a design contract.
---

# Implement Design Doc (Java)

You are implementing Java domain model code from a DesignDoc JSON contract. The contract is the single source of truth for what the code must contain. Your job is to produce Java code that faithfully represents every building block, property, behaviour, and relationship described in the contract, while matching the style and conventions of the target project.

## Core Principles

1. **DesignDoc JSON is authoritative.** Every building block, property, behaviour, and structural relationship in the JSON must be reflected in code. Never invent domain concepts not in the contract. If something is ambiguous, ask the user.

2. **Adapt to the project's style.** Before writing any code, read existing sources to detect the project's conventions (see Style Detection below). The contract dictates *what* exists; the project dictates *how* it looks.

3. **Reuse existing classes — never duplicate.** When a building block's `description` says "Already exists in the project" or a class with that name already exists in the codebase, import it from its current location. Do not create a new copy in a different package. Search the project for the class before creating it. This is critical for types like shared value objects (IDs, Money) that are used across modules.

4. **Replicate the project's exact patterns.** When the project uses a specific pattern for domain events (e.g., `sealed interface Event permits ...` with inner records), aggregates (e.g., `pendingEvents` + `flushEvents()`), or use case coordination (e.g., facade + package-private services + @Configuration), replicate that exact pattern. Do not substitute a different pattern even if it's valid DDD — the goal is consistency with the existing codebase.

5. **Implement domain model only.** Infrastructure implementations (persistence, messaging, HTTP) are out of scope unless the contract explicitly includes `external_integration` building blocks. Repository interfaces are in scope; their implementations are not.

6. **Tests are out of scope.** Other skills or project conventions handle testing. Focus exclusively on production domain code.

## Input

A DesignDoc JSON conforming to the schema at `contracts/design-doc-schema.json`. The JSON contains:

- `boundedContexts` with `modules` and `buildingBlocks` references
- `buildingBlocks` — flat list, each with `type`, `properties`, `behaviours`
- `rules` — business rules referenced by behaviours
- `useCases` — application-level orchestrations referencing building blocks
- `actors`, `businessGoals`, `domainConcepts`, `scenarios` — contextual information

See [designdoc_mapping.md](references/designdoc_mapping.md) for the complete mapping rules from JSON to Java.

## Workflow

### 1. Detect project style

Before writing any code, read the target project to understand its conventions:

1. **Find the build system** — look for `pom.xml` or `build.gradle` to determine Java version and dependencies
2. **Read CLAUDE.md** and any project-level instructions — they may override default patterns
3. **Sample 3-5 existing domain classes** across different building block types (aggregates, value objects, services) and note:
   - Package structure (how bounded contexts and modules map to packages)
   - Naming conventions (class names, method names, field access)
   - Annotation usage (Lombok, JPA, custom annotations, or none)
   - Error handling pattern (exceptions, Result/Either monads, Optional)
   - **Domain event pattern** — this is critical: does the project use a marker interface? sealed interfaces with inner records? separate event classes with @Value? a pendingEvents list flushed from aggregates? Copy the exact mechanism.
   - Value object style (records, final classes, Lombok @Value)
   - Encapsulation style (package-private vs public, accessor methods vs direct fields)
   - Constructor patterns (static factories, builders, plain constructors)
   - Repository interface style (method naming, return types)
   - **Application service / use case coordination pattern** — does the project use: facades delegating to package-private services (with Spring @Configuration wiring)? command/handler pairs (Command<R> + CommandHandler<C,R>)? service-per-use-case classes? This determines how you structure the application layer.

4. **Search for existing shared types** — before creating any value object, search the entire project for a class with that name. Especially for ID types and Money-like types which are commonly shared across modules. If found, import it — do not create a duplicate.

Document detected conventions in a mental checklist before proceeding. When the project has no existing code in a category, fall back to standard Java DDD patterns.

### 2. Resolve the DesignDoc

Parse the JSON and build a mental model:

1. **Map ownership** — for each `buildingBlock`, determine which `boundedContext` and `module` owns it (via `buildingBlocks` id references in contexts/modules)
2. **Resolve references** — behaviours reference other building blocks by id (in `input`/`output` fields) and rules by id. Resolve these to actual names and types.
3. **Identify dependencies** — which building blocks reference which others, to determine implementation order
4. **Detect what already exists** — search the codebase for classes matching building block names. Existing classes need modification, missing ones need creation.

### 3. Plan implementation batches

Group by dependency order:

1. **Value Objects** — no domain dependencies, implement first
2. **Domain Events** — typically simple immutable records
3. **Entities** — may depend on value objects
4. **Aggregates** — depend on entities, value objects, events
5. **Domain Services** — coordinate multiple domain objects
6. **Repositories** — interfaces referencing aggregate roots
7. **Application Services / Use Cases** — orchestrate everything above
8. **Factories** — complex creation logic

### 4. Implement or modify code

For each building block, follow the mapping rules in [designdoc_mapping.md](references/designdoc_mapping.md).

**For new classes:** Create in the correct package following the project's package structure conventions. Match the style detected in step 1.

**For existing classes:** Compare the DesignDoc contract with what exists:
- Missing properties → add fields
- Missing behaviours → add methods
- Changed types → update types
- Missing building blocks within an aggregate → add inner/companion classes
- Present edits as minimal diffs — don't rewrite files unnecessarily

**Key rules for all code:**
- Every `property` in the JSON becomes a field in the class
- Every `behaviour` becomes a method. The behaviour's `description` informs the method's purpose. `input` and `output` references determine parameter and return types.
- `rules` referenced by a behaviour represent business logic that the method must enforce
- The `description` field on building blocks informs relationships and responsibilities — parse it for mentions of ownership, containment, and collaboration patterns

### 5. Verify completeness

After implementation, verify that:
- Every building block in the JSON has a corresponding class
- Every property is represented as a field
- Every behaviour is represented as a method
- Every rule referenced by a behaviour is enforced in the method's logic
- Package structure reflects the bounded context / module hierarchy
- Use cases are wired to the correct building blocks

Present a summary to the user mapping each DesignDoc element to its code location.

## Style Detection Cheat Sheet

| What to detect | Where to look | How it affects output |
|---|---|---|
| Java version | `pom.xml` / `build.gradle` | Records (16+), sealed classes (17+), pattern matching |
| Lombok | `lombok.config`, imports | Use @Value, @Builder, @RequiredArgsConstructor if project uses them |
| Error handling | Aggregate methods, service returns | Match: exceptions, Result monad, Either, checked exceptions |
| Event pattern | Existing domain events | Match: records, classes, marker interfaces, event bus |
| Package layout | src/main/java structure | Match: flat vs layered (domain/application/infrastructure) |
| Encapsulation | Access modifiers on existing classes | Match: package-private children, public API surface |
| Immutability | Field declarations, setters | Match: final fields, records, defensive copies |
| Constructor style | Existing constructors | Match: static factories, builders, plain |
| Repository location | Existing repository interfaces | Match: separate file vs **nested interface inside aggregate** (e.g., `Order.Repository`) |
| DI framework | Spring/Guice/CDI annotations | Match: @Component, @Service, configuration classes |

## Scope

**IN:** Domain model classes, value objects, aggregates, entities, domain events, domain services, application services, repository interfaces, factory classes — all derived from DesignDoc JSON.

**OUT:** Tests, infrastructure implementations, UI, database migrations, build configuration, design changes. If the contract seems wrong, ask — don't fix it silently.
