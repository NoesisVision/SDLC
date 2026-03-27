# DesignDoc JSON to Java Mapping Rules

This document defines how each element in a DesignDoc JSON maps to Java code. These rules are non-negotiable — they define correctness. Style (how the code looks) is determined by the target project's conventions.

## Package Structure

The bounded context / module hierarchy determines the Java package structure:

```
BoundedContext "Subscription"
  └── DomainModule "Company"
        └── BuildingBlock "CompanySubscription" (aggregate)
```

Maps to a package like:
```
{base.package}.subscription.company
```

The exact mapping depends on the project's existing conventions. If the project uses layered sub-packages (e.g., `domain/`, `application/`), follow that. If the project keeps everything flat within a module package, follow that.

Building blocks not assigned to any module but assigned to a bounded context go directly under the context's package.

## Handling "Already Exists" Building Blocks

Some building blocks in the DesignDoc have descriptions like "Already exists in the project" or similar. For these:

1. **Search the project** for a class with that exact name using Glob or Grep
2. **Import it** from its existing location — do NOT create a new file
3. **Reference its existing API** (method names, field names) rather than assuming the DesignDoc properties are its interface
4. If the class genuinely does not exist in the project despite the description, create it in the shared/common package following the project's conventions — not in the new module's package

This prevents duplicate classes across packages, which breaks type compatibility.

## BuildingBlock Type → Java Class

### `aggregate`

The aggregate root class. This is the entry point for all operations on the aggregate.

- **Properties** → private fields (or records fields if project uses records for aggregates, which is uncommon)
- **Behaviours** → public methods on the aggregate root
  - `input` references → method parameters (resolve to the referenced building block's Java type)
  - `output` references → return type or emitted events (resolve to the referenced building block's Java type)
  - `rules` references → business logic enforced inside the method body
- **Description** → parse for mentions of child entities/value objects that this aggregate contains

Aggregates own their internal entities. If the description mentions containment (e.g., "contains OrderItem entities"), those entities should be package-private or inner classes accessible only through the aggregate.

### `entity`

An entity within an aggregate or standing alone.

- **Properties** → private fields, one of which is the identity field
- **Behaviours** → methods that mutate state or query state
- Entities have identity — ensure equals/hashCode is based on the identity field
- If the entity belongs to an aggregate (mentioned in aggregate's description), it should have restricted visibility (package-private or inner class)

### `value_object`

Immutable type representing a domain concept without identity.

- **Properties** → final fields (or record components)
- **Behaviours** → methods (typically returning new instances for transformations)
- Must be immutable — no setters, all fields final
- Validation in constructor (or static factory) based on referenced rules
- Equality by all fields (structural equality)

### `domain_event`

An immutable record of something that happened.

- **Properties** → final fields capturing the event data
- Must be immutable
- Name should be past-tense (the JSON `name` field defines this)
- Typically includes a timestamp and relevant aggregate identifiers

**Critical: match the project's event pattern exactly.** Projects use different mechanisms:
- **Sealed interface with inner records** (modern Java): `sealed interface Event permits Deposited, Withdrawn {}` with `record Deposited(...) implements Event {}` inside the aggregate class
- **Marker interface with separate classes**: `interface DomainEvent {}` + `@Value public class OrderCreated implements DomainEvent {}`
- **Plain classes**: separate file per event, manual equals/hashCode

Look at how the **aggregate** in the project stores and emits events — e.g., `List<Event> pendingEvents` vs `List<DomainEvent> pendingEvents` vs `List<Object>`. Use the same type. If the project uses a sealed interface scoped to the aggregate, your new aggregate must define its own sealed interface for its events.

### `domain_command`

A request to perform an action.

- **Properties** → fields capturing the command data
- Should be immutable
- Name should be imperative (the JSON `name` field defines this)

### `domain_query`

A request for information.

- **Properties** → fields capturing the query parameters
- Should be immutable

### `domain_service`

Stateless domain logic that doesn't belong to a single aggregate.

- **Behaviours** → methods coordinating multiple domain objects
- No mutable state — all dependencies injected
- `input`/`output` on behaviours determine method signatures

### `application_service`

Orchestrates use cases by coordinating domain objects, repositories, and services.

- **Behaviours** → use case methods (typically one per service, or one per use case)
- Depends on repositories and domain services
- Handles transaction boundaries
- The `useCases` section of the DesignDoc provides additional context for what application services should orchestrate

### `repository`

Interface for persisting and retrieving aggregates.

- **Behaviours** → interface methods (save, find, delete, etc.)
- `input`/`output` reference the aggregate type
- Implementation is OUT OF SCOPE — only generate the interface
- Follow project's repository naming and return type conventions (Optional, nullable, etc.)

### `factory`

Encapsulates complex creation logic.

- **Behaviours** → factory methods
- `output` references → the type being created
- `input` references → the data needed for creation
- Can be a static method on the aggregate, a separate class, or an abstract factory — match project conventions

### `external_integration`

Interface for external system communication.

- Generate as an interface (port) in the domain layer
- Implementation is OUT OF SCOPE

## Rules Mapping

Rules referenced by behaviours map to business logic within the method:

| Rule Type | Java Implementation |
|---|---|
| `Consistency` | Invariant check — validate state before/after mutation, throw or return failure if violated |
| `Structure` | Structural constraint — enforce in constructor or factory (field constraints, required relationships) |
| `Computation` | Calculation logic — implement the formula described in the rule's `description` |
| `State change` | State transition guard — check preconditions before allowing state change |

The rule's `description` field contains the actual business rule in natural language. Translate it to code.

## UseCases Mapping

Use cases in the DesignDoc provide higher-level orchestration context:

- `type: Command` → a use case that changes state. Map to an application service method.
- `type: Event` → a use case triggered by an event. Map to an event handler.
- `type: Query` → a read operation. Map to a query service or read model.

The `usedBuildingBlocks` field tells you which building blocks the use case orchestrates.
The `input`/`output` fields tell you the command/query/event types and the response types.
The `scenarios` (Given/When/Then) describe the expected behavior — useful for understanding the method's logic.
The `rules` field lists business rules that must be enforced in this use case.

## Behaviour → Method Mapping Details

For each behaviour on a building block:

```json
{
  "name": "enroll",
  "description": "Enrolls a subscriber if subscription is active and has capacity",
  "input": ["bb-subscriber-id"],
  "output": ["bb-subscriber-enrolled-event"],
  "rules": ["rule-active-subscription", "rule-capacity-check"]
}
```

Maps to:

```java
// Method name from behaviour.name
// Parameter type from resolving bb-subscriber-id → SubscriberId
// Return type from resolving bb-subscriber-enrolled-event → SubscriberEnrolled (or Result containing it)
// Body enforces rule-active-subscription and rule-capacity-check
```

The exact method signature (return type wrapping, exception style) depends on the project's detected conventions.
