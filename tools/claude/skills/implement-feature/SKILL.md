---
name: Implement Feature
description: Implement production-ready .NET code based on design specifications using P3 Model, DDD tactical patterns and clean architecture principles. Use it when user asks to implement a feature that has a design specification.
---

# Implement Feature

## Core Principles

**Design specification is authoritative** - Never deviate. If unclear, use AskUserQuestion tool to clarify before implementing.

**Implement ONLY domain model** - Domain building blocks from specification only. NO Adapters layer code.

**Critical constraints:**
- NEVER add code comments (XML docs, inline comments, or explanatory comments)
- P3 DomainModules: First-level = .NET project, nested levels = namespaces
- NO architecture/pattern names in namespaces (UseCases, Application, Domain, Repositories)
- Types from different Clean Architecture layers MUST be in same project/namespace
- You MUST add Noesis annotations (eg. `[DddAggregate]`, `[EntryPoint]`, `[UseCasesLayer]`) for each P3 Element implementation using 'NoesisVision.Annotations' NuGet package.
- You MUST NOT create unnecessary interfaces. Create interfaces ONLY for polymorphism and ports from Clean Architecture (like Repositories).
- You MUST NOT use prefix 'I' for interfaces.
- You MUST implement test as BDD scenarios using 'BDD-toolkit-dotnet' NuGet package.

## Workflow

1. **Locate design** - Find and validate design.md, extract P3 Model Changes and BDD scenarios
2. **Analyze codebase** - Identify module structure, existing patterns, dependencies
3. **Plan batches** - Group by dependencies: Value Objects → Aggregates → Services → Handlers
4. **Implement + Test** - Code each batch, write test for each BDD scenario ONLY. No other tests.
5. **Verify** - Run tests, check acceptance criteria
6. **User review** - Present summary, get approval

**Priority:** Design spec > Existing patterns > Common DDD patterns

## Detailed Steps

### 1. Locate Design

**Find:** User path OR glob `specs/**/design.md` OR ask user
**Validate:** Must contain Purpose, FRs (FR-XX), P3 Model Changes (MC-XX)
**Extract:** P3 changes, Business Rules (BR-XX), Relations, BDD scenarios

If missing sections: Ask user to proceed or fix design first.

### 2. Analyze Codebase

**Structure:** Find .sln, identify bounded contexts, locate target module for P3 changes
**Patterns:** Use [implementation-patterns.md](implementation-patterns.md) as reference
**Dependencies:** Map upstream/downstream for each P3 change, check for circular refs

### 3. Plan Batches

Group by dependency order:
1. **Foundation**: Value Objects, Domain Events
2. **Core**: Aggregates, Entities
3. **Logic**: Policies, Domain Services
4. **Application**: Use Case Handlers

Never implement code before its dependencies exist.

### 4. Implement + Test Each Batch

Complete each batch fully before next. Follow [implementation-patterns.md](implementation-patterns.md).

**Per P3 element:**
- **Value Objects**: Immutable record/struct, validation in constructor, operators if needed
- **Aggregates/Entities**: Private setters, domain events (private collection), business rules as methods, invariant validation
- **Policies**: Interface + implementation, stateless, use Value Objects
- **Domain Services**: Interface + orchestration of aggregates
- **Handlers**: Thin orchestrators, inject dependencies, load → execute → persist
- **Repositories**: Interface only (NO implementation - out of scope)

**Namespace placement** (per implementation-patterns.md):
- NO "Domain", "Application", "Policies", "Services" in namespace names
- Use P3 DomainModule hierarchy: `{BoundedContext}.{Module}.{NestedModule}`
- Mix Clean Architecture layers in same namespace

**Tests** (write IMMEDIATELY after each component):
- Write test ONLY for BDD scenarios from design spec
- NO additional tests beyond BDD scenarios
- Use NUnit + FluentAssertions
- MUST pass before next component

**DI registration** (after batch complete):
- Register per existing codebase patterns

**Validation before next batch:**
- All implemented, all BDD tests pass, DI registered, no warnings

### 5. Verify

**Check acceptance criteria:** Map FRs, BRs, P3 changes (MC-XX) to code
**Run tests:** `dotnet test` - all must pass
**Build:** `dotnet build -warnaserror` - no warnings
**Summary:** List files, decisions, deviations (if any)

### 6. User Review

**Present:** Scope, files, test results, acceptance verification, decisions/deviations
**Ask (AskUserQuestion):** Approve / Request changes / Add functionality
- Changes → return to Step 4 (specific batch)
- Add functionality → return to Step 1
- Approve → finalize (commit, confirm)

NEVER mark complete without explicit approval.

## Scope

**IN:** Domain model, behaviors, handlers, BDD tests for scenarios, DDD patterns, existing conventions
**OUT:** Design changes, UI, DevOps, DB migrations, Repository implementations, Adapters layer

If design unclear: AskUserQuestion (never guess)

## Style Standards

**Patterns:**
- Screaming architecture (structure = business domain)
- Explicit over implicit
- Rich domain model (logic in aggregates/VOs, thin handlers)
- Factory methods on types (not separate factories unless complex)

**Code quality:**
- Immutable by default
- Domain validation in constructors
- Ubiquitous language in names
- No primitive obsession
- Proper encapsulation (private setters)
- **NO code comments** (no XML docs, no inline comments)
- No warnings

See [implementation-patterns.md](implementation-patterns.md)

## Critical Enforcements

1. **Never deviate from design** - AskUserQuestion if unclear
2. **Test immediately after component** - No untested code
3. **Follow existing patterns** - Match codebase conventions
4. **Implement in dependency order** - Dependencies first
5. **Rich domain model** - Logic in aggregates/VOs, thin handlers
6. **Immutability + encapsulation** - Private setters, controlled state
7. **NEVER add comments** - No XML docs, no inline comments, no explanations
8. **Noesis annotations** - Use attributes from `NoesisVision.Annotations' NuGet package
9. **NO unnecessary interfaces** - Create interfaces ONLY for polymorphism and ports from Clean Architecture
10. **Tests as BDD scenarios** - Use 'BDD-toolkit-dotnet' NuGet package for tests implementation.
