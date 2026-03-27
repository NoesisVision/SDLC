# Design Doc Contract — Schema Design Spec

## Context and Goal

The Design Doc Schema describes the target state ("to be") of a system after implementation. It serves as:

- A complement to design documents — a strict, machine-validatable description of planned changes
- Input for an implementing agent (Java)
- A checklist for validating agent output after implementation

**Format**: Pydantic (source of truth) + generated JSON Schema (for validation in Java via `model_json_schema()`)

**File**: `contracts/design_doc_schema.py`

**First iteration scope**: No `Decision`, no `State` enum. Includes `DomainConcept`, simplified `QualityAttribute`, structured `Scenario`.

## Key Design Decisions

1. **"To be" only** — the contract describes the target state, not change operations (create/modify/delete). Context about what changed is in `description` fields.
2. **Unified BuildingBlock** — one `BuildingBlock` class with a `type` enum instead of 11 separate classes (Aggregate, Entity, ValueObject, etc.).
3. **Relationships in description** — relationships between BB (e.g., aggregate contains entity) are expressed in `description` text, not structural fields.
4. **No Decision** — excluded from first iteration scope.
5. **No State enum** — unnecessary since the contract is a "to be" image.
6. **Pydantic + JSON Schema** — Pydantic for readability and review, generated JSON Schema for language-agnostic validation.
7. **DomainConcept as glossary** — defines Ubiquitous Language terms without explicit references from other types. Connection to code through naming.

## Schema Structure

### Enums

| Enum | Values |
|------|--------|
| `RuleType` | Consistency, Structure, Computation, State change |
| `UseCaseType` | Command, Event, Query |
| `QualityAttributeType` | performance, availability, security, other |
| `BuildingBlockType` | aggregate, entity, value_object, domain_event, domain_command, domain_query, domain_service, application_service, repository, factory, external_integration |

### Base Types

**Property**: `{name: str, type: str}` — a field/property of a building block.

**Behaviour**: `{name: str, description: str, input: list[BB id], output: list[BB id], rules: list[Rule id]}` — a behaviour/method on a building block. No `emits` field.

**Rule**: `{id: str, rule_type: RuleType, description: str}` — a business rule. No `State` field.

### Domain Elements

**Actor**: `{id, name, description}` — a user or system interacting with the system.

**BusinessGoal**: `{id, name, description}` — a business objective. Referenced optionally from UseCase.

**DomainConcept**: `{id, name, description}` — Ubiquitous Language term. No explicit references from other types; connection through naming conventions in code.

**QualityAttribute**: `{id, name, type: QualityAttributeType, description}` — non-functional requirement. Types: performance, availability, security, other. No CAPEX/OPEX.

**Scenario**: `{name, description, given, when, then}` — structured acceptance scenario (Given/When/Then).

### Building Block (unified)

```
BuildingBlock: {
    id: str,
    name: str,
    type: BuildingBlockType,
    description: str,
    properties: list[Property],
    behaviours: list[Behaviour]
}
```

Replaces 11 separate classes. Relationships between BBs (e.g., aggregate contains entities) are described in the `description` field. No `owner` field — ownership is expressed through BoundedContext/DomainModule hierarchy.

### Organizational Structure

**DomainModule**: `{id, name, description, building_blocks: list[BB id]}` — Domain Module in the Eric Evans sense. Contains references to BuildingBlocks.

**BoundedContext**: `{id, name, description, modules: list[DomainModule], building_blocks: list[BB id]}` — Bounded Context. Contains DomainModules and/or direct BB references (for BBs not in any module).

Hierarchy: BoundedContext -> DomainModule -> BuildingBlock

### UseCase

```
UseCase: {
    id: str,
    name: str,
    actor: str (Actor id),
    type: UseCaseType,
    description: str | None,
    business_goal: str | None (BusinessGoal id, optional),
    input: list[BB id],
    output: list[BB id],
    used_building_blocks: list[BB id],
    rules: list[Rule id],
    scenarios: list[Scenario],
    qualities: list[QA id]
}
```

No `side_effects`, no `bounded_context` (ownership through hierarchy), no `state`.

### Root: DesignDoc

```
DesignDoc: {
    actors: list[Actor],
    business_goals: list[BusinessGoal],
    domain_concepts: list[DomainConcept],
    rules: list[Rule],
    quality_attributes: list[QualityAttribute],
    bounded_contexts: list[BoundedContext],
    building_blocks: list[BuildingBlock],
    use_cases: list[UseCase],
    scenarios: list[Scenario]
}
```

All BuildingBlocks are defined flat at root level. BoundedContexts and DomainModules reference them by id. Scenarios appear both at root level (for flexibility) and nested in UseCases.

## Changes from PR #1 Schema

| Aspect | PR #1 | This design |
|--------|-------|-------------|
| BB modeling | 11 separate classes | 1 unified `BuildingBlock` with type enum |
| BB relationships | Structural fields (entities, value_objects on Aggregate) | In `description` text |
| Ownership | `owner` field on each BB + lists on Module/BC | Module/BC hierarchy only |
| Behaviour.emits | Present | Removed |
| State enum | Confirmed/Assumed | Removed (contract is "to be") |
| Decision | Not present | Explicitly excluded from scope |
| DomainConcept | Discussed but not added | Added as UL glossary |
| Scenario | name, description, content | name, description, given, when, then |
| QualityAttributeType | incl. CAPEX, OPEX | Removed CAPEX, OPEX |
| Attribute | name, type | Renamed to Property |
| BusinessGoal | Required on UseCase | Optional reference from UseCase |
| Actor | Not a separate type | Separate type with id |
