---
name: domain-model-builder
description: >
  Build C# domain model classes from well-described requirements using DDD tactical patterns.
  Use when the user asks to design, create, or implement domain models, aggregates, entities,
  value objects, domain services, or domain events in C#. Also trigger when the user mentions
  "bounded context," "aggregate root," "invariant," "domain layer," or provides a requirement
  document and wants C# domain classes generated. Not for CRUD scaffolding, API endpoints,
  or UI work — this skill focuses on the domain layer only.
---

# C# Domain Model Builder

Single-context, domain-first skill for generating C# domain model classes from well-described requirements. No subagent delegation, no layer decomposition, no orchestrator state files. Runs entirely in main context to maximize reasoning depth for domain decisions.

## When to Use

- User provides a requirement (document, conversation, or file) and wants C# domain classes
- Task scope: roughly 3-20 domain classes (aggregates, entities, value objects, services, events)
- User understands the domain — this skill is a design partner, not a discovery tool

**Do NOT use when**: requirement is vague and needs extensive research (use a research workflow instead), task is primarily CRUD/API/UI scaffolding, or scope exceeds ~20 domain classes (decompose first).

## Input

The skill accepts requirements in any form: a file path, inline description, or prior conversation context. It does NOT require a specific template. If a `.maister/docs/standards/` directory exists, scan it once at the start for relevant conventions — but do not run a discovery pipeline.

## Workflow

Four phases. No mandatory gates — phases flow naturally. User intervenes when they want, not when forced.

---

### Phase 1: Domain Comprehension & Model Sketch

**Read before executing**: `references/phase-1-comprehension.md`, `references/aggregate-heuristics.md`

1. Read the requirement (argument, file, or conversation context)
2. If project has existing domain classes, do a **targeted scan** — grep for types the new model will interact with. Do NOT analyze the full codebase.
3. Produce a **domain model sketch** — structured text listing all aggregates, entities, value objects, domain services, domain events, their relationships, and invariants
4. Present the sketch to the user

The sketch is the primary design artifact. No code is written until the sketch is agreed upon.

→ Present sketch, continue to Phase 2 immediately

---

### Phase 2: Interactive Design Negotiation

**Read before executing**: `references/phase-2-negotiation.md`

Review the sketch and raise domain modeling questions:
- Aggregate boundary decisions
- Entity vs value object classification
- Invariant ownership and enforcement strategy
- Domain event necessity
- Relationship directionality (reference by ID vs containment)

This is free-form conversation. No rigid question count. Claude raises the questions it actually has about the domain design — could be two questions, could be eight. User responds, sketch gets updated.

**Decision log**: Each resolved question becomes a one-line design decision that will persist as a code comment.

→ When the user confirms the sketch (or says to proceed), continue to Phase 3

---

### Phase 3: Vertical Implementation

**Read before executing**: `references/phase-3-implementation.md`, `references/csharp-domain-idioms.md`, `references/anti-patterns.md`

Implement one aggregate (or domain service) at a time as a complete vertical slice:

```
Per aggregate/concept:
  1. Value objects it depends on
  2. Child entities
  3. Aggregate root (with invariants and domain event emission)
  4. Repository interface
  5. Unit tests for invariants and key behaviors
```

Within each slice, write invariant tests before the implementation code. If implementing a later slice reveals a needed change in an earlier one, fix it directly — no re-planning cycle.

After all slices: generate any cross-aggregate domain services and their tests.

→ When all classes are generated, continue to Phase 4

---

### Phase 4: Cross-cutting Verification

**Read before executing**: `references/phase-4-verification.md`

1. Run `dotnet build` — fix compile errors directly
2. Run generated tests — fix failures directly
3. Domain integrity review: single pass checking invariant coverage, aggregate isolation, encapsulation, anemic model detection
4. Brief summary: what was built, key design decisions, anything that may need attention

---

## Project Convention Detection

At the start of Phase 1, do a lightweight scan (not a full discovery):
- Look at ONE existing aggregate in the project (if any) for namespace pattern, folder structure, base classes, naming
- Check for a `.editorconfig` or `Directory.Build.props` for code style settings
- If `.maister/docs/standards/` exists, read the index file only — load specific standard files only if their names suggest domain/architecture relevance

Apply discovered conventions throughout. If no existing domain code exists, use the idioms from `references/csharp-domain-idioms.md` as defaults.

## Token Budget

This skill should complete within 30-50K tokens for a typical 10-15 class domain model. If you find yourself exceeding this, something is wrong — you are likely over-analyzing or over-generating. Stop, check if you're doing unnecessary work, and course-correct.
