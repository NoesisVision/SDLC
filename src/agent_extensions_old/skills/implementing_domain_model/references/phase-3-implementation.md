# Phase 3: Vertical Implementation

## Implementation Order

Work through the sketch top-to-bottom by aggregate. Within each aggregate, build inside-out:

```
1. Shared value objects (used across multiple aggregates) — implement once, first
2. Per aggregate (in dependency order):
   a. Value objects local to this aggregate
   b. Child entities
   c. Aggregate root class (with invariants)
   d. Repository interface (in domain layer — no implementation)
   e. Unit tests for invariants and behaviors
3. Domain services (after all aggregates they coordinate exist)
4. Domain event classes (can be done with their emitting aggregate or batched at end)
```

### Why Inside-Out

Value objects have no dependencies — they compile and test independently. Child entities depend on value objects. The aggregate root depends on both. This order means every class compiles as you write it. No forward references, no placeholder types.

## Per-Class Implementation Pattern

### Before Writing Each Class

1. Check the sketch for this class's role, invariants, and relationships
2. Check the decision log for any design decisions affecting this class
3. If modifying existing code, read the current file first
4. If this class interacts with existing project types, read those types

### Writing the Class

Apply the patterns from `csharp-domain-idioms.md` for the class type (value object, entity, aggregate root, etc.).

For every invariant listed in the sketch:
- Write the guard/enforcement logic inside the appropriate method
- Add the design decision as an XML doc comment if one exists

For every domain event listed in the sketch:
- Emit it from the method that causes the state transition
- Use the aggregate's event collection pattern (from idioms reference)

### After Writing Each Class

- Verify it compiles in isolation (mentally — don't run build after every file)
- Check: does this class expose any mutable state it shouldn't? (See anti-patterns reference)
- Check: did I add any method that nothing calls? Remove it.

## Test Writing Strategy

Write tests per aggregate, not per class. Each test file covers one aggregate's invariants and behaviors.

### What to Test

- **Every invariant from the sketch.** If the sketch says "slots cannot overlap," there must be a test that adds overlapping slots and asserts the failure.
- **State transitions.** If an aggregate moves through statuses (Draft → Confirmed → Cancelled), test valid and invalid transitions.
- **Domain event emission.** Assert that the correct events are raised when expected actions occur.
- **Value object equality.** One test per value object confirming equality by value and inequality when attributes differ.
- **Factory methods / constructors.** Test that invalid construction is rejected.

### What NOT to Test

- Getters and property access (no behavior, no value)
- Private implementation details
- ORM/persistence behavior (not domain layer concern)
- Anything that would require mocking infrastructure

### Test Count Guideline

For a typical aggregate with 3-5 invariants: expect 6-12 tests. For a simple value object: 2-3 tests. Don't aim for a number — aim for every invariant and state transition being covered.

## Mid-Implementation Course Correction

Because this runs in a single context, you can and should fix earlier classes when later work reveals issues:

**When to fix forward:**
- A method signature on aggregate A needs an extra parameter discovered while implementing service B
- A value object needs an additional property discovered while writing the aggregate root
- A child entity's relationship to the root needs adjustment

**How to fix:**
- Go back and edit the earlier file directly
- Update its tests if the interface changed
- Note the change briefly: "Updated [class]: added [what] because [why]"
- Do NOT create a change plan, report, or ask permission — just fix it

**When to pause and ask the user:**
- The fix would change an aggregate boundary (structural decision)
- The fix contradicts a design decision from Phase 2
- The requirement itself seems incomplete or contradictory

## File Organization

Follow the project's existing pattern if one was detected in Phase 1. If no pattern exists, use:

```
src/[Project].Domain/
├── Aggregates/
│   └── [AggregateName]/
│       ├── [AggregateName].cs          (aggregate root)
│       ├── [ChildEntity].cs            (child entities, if any)
│       ├── [ValueObject].cs            (aggregate-local value objects)
│       ├── Events/
│       │   └── [EventName].cs
│       └── I[AggregateName]Repository.cs
├── SharedKernel/                       (shared value objects, base classes)
│   ├── Entity.cs
│   ├── AggregateRoot.cs
│   ├── ValueObject.cs
│   └── IDomainEvent.cs
└── Services/
    └── [ServiceName].cs

tests/[Project].Domain.Tests/
├── Aggregates/
│   └── [AggregateName]/
│       └── [AggregateName]Tests.cs     (one test file per aggregate)
└── SharedKernel/
    └── [ValueObject]Tests.cs           (shared VO tests)
```

If the project already has domain classes in a different structure, match that structure exactly. Consistency with the existing project trumps this default layout.
