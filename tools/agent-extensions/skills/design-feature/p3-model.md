# P3 Model Semantic

## Core Principles

P3 Model is a **general-purpose modeling framework** organizing system abstractions into three perspectives (Domain, Technology, People).

**Style-agnostic:** supports rich domain models, anemic architectures, functional designs, etc.

**Tagging Philosophy:** Use tags to express architectural patterns (DDD, CQRS, Clean Architecture, etc.) without changing core P3 structure.

**Element Properties:**
- Id: system-wide unique identifier
- Type: {DomainModule, DomainObject, DomainBehavior}
- Name: meaningful to team, consistent terminology
- Tags: architectural patterns, cross-cutting concerns

**Relation Properties:**
- Source: Element that originates relation
- Target: Element that is related to
- Type: Explicit relation type name

**CRITICAL:** Focus EQUALLY on Elements AND Relations. Relations are explicit, named connections that define system structure.

## Domain Perspective Elements

### DomainModule
**Purpose:** Primary organizational unit for cohesive concepts.

**Relations:**
- **DomainModule.ContainsModule** → nested DomainModules
- **DomainModule.ContainsObject** → DomainObjects
- **DomainModule.ContainsBehavior** → standalone DomainBehaviors

**Guidelines:**
- Use business terminology (e.g., "OrderManagement", "CustomerBilling")
- Avoid technical divisions (e.g., "Repositories", "Services", "API")

### DomainObject
**Purpose:** Building block representing entity/concept. Can be:
- **Rich objects:** persistent data + behaviors changing this data according to rules
- **Anemic objects:** data containers (DTOs, entities) without behaviors
- **Service objects:** set of behaviors connected to single domain concept without persistent data

**Outgoing Relations:**
- **DomainObject.ContainsBehavior** → DomainBehaviors (common in rich, rare in anemic)
- **DomainObject.UsesObject** → other DomainObjects

### DomainBehavior
**Purpose:** Active operation guarding business rules. Two forms:
1. **Object Behavior:** associated with DomainObject via DomainObject.ContainsBehavior relation
2. **Standalone Behavior:** associated directly with DomaionModule via DomainModule.ContainsBehavior relation

**Relations:**
- **DomainBehavior.UsesObject** → DomainObjects
- **DomainBehavior.InvokesBehavior** → other DomainBehaviors

## Decision Guide: Object vs Standalone Behavior

**Attach to DomainObject when:**
- operates on object's state.
- Enforces State-Change rules.
- Is meaningful only in object context.

**Create Standalone Behavior when:**
- Process step orchestration (entry point)
- No natural owner

## Workflow for Designing P3 Models

**Creating Elements:**
1. Identify system concept
3. Determine element type (Module/Object/Behavior)
4. Check existing elements
5. Create element with name, type, tags

**Creating Relations:**
6. Structural: ContainsModule/Object/Behavior
7. Object dependencies: UsesObject
8. Invocations: InvokesBehavior

**Validation:**
9. Check cohesion

## Tags

You MUST use ONLY tags listed below.
**DDD:** DddAggregate, DddApplicationService, DddDomainService, DddEntity, DddFactory, DddRepository, DddValueObject
**Anemic:** Entity, DTO, Service, Repository, InputValidator
**Communication:** Command, Event, Query, EntryPoint
**Integration:** ExternalSystemIntegration
