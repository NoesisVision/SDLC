# Phase 2: Interactive Design Negotiation

## Purpose

Refine the domain model sketch through targeted conversation. You are not gathering requirements — the requirement is already provided. You are making **domain modeling design decisions** that the requirement doesn't explicitly answer.

## What to Question

Only raise questions that change the code structure. Skip anything cosmetic or obvious.

### Aggregate Boundary Questions

Ask when you see:
- Two concepts that *might* be one aggregate or two separate ones
- A child entity that has its own lifecycle (might need its own aggregate)
- A reference between aggregates where containment vs ID-reference is unclear

Frame as: "In the sketch, [X] contains [Y]. But [Y] seems to have an independent lifecycle because [evidence]. Should [Y] be its own aggregate referenced by ID, or stay contained inside [X]?"

### Entity vs Value Object Questions

Ask when you see:
- A concept that *could* be either — has some attributes but unclear if identity matters
- Properties that always appear together (extraction candidate)
- Something the requirement treats as a "thing" but that has no lifecycle

Frame as: "[X] appears in the sketch as an entity, but it has no independent lifecycle and is only meaningful inside [Y]. Should it be a value object instead?"

### Invariant Ownership Questions

Ask when you see:
- A rule that references data from multiple aggregates
- A validation that could live on the entity, the aggregate root, or a domain service
- Conditional rules ("only when status is X") where the condition-holder and the rule-enforcer differ

Frame as: "The rule '[invariant]' involves data from both [A] and [B]. Should this be enforced by [A] (which would need to receive [B]'s data as a parameter), or should a domain service coordinate this?"

### Domain Event Questions

Ask when you see:
- A state transition that other parts of the system might react to
- A side effect mentioned in the requirement ("send notification", "update counter")
- Cross-aggregate consequences of an action

Frame as: "When [action] happens on [Aggregate], does the rest of the system need to know? If so, I'll add a [EventName] domain event."

### Relationship Direction Questions

Ask when you see:
- Bidirectional references in the requirement ("order has items, item belongs to order")
- Navigation needs that might force wrong aggregate structure

Frame as: "[A] references [B] and [B] references [A] in the requirement. In the domain model, which direction is the ownership? Typically only one side holds the reference."

## What NOT to Question

- Implementation details (which ORM, which database, which serialization)
- Naming preferences unless there's a genuine ambiguity
- Testing strategy (the skill handles this)
- Things the requirement already answers clearly
- Theoretical DDD debates — make a pragmatic choice and note it

## Decision Log Format

For each resolved question, record a one-line decision. These become XML doc comments in the generated code.

```
## Design Decisions

1. TimeRange is a value object — no identity, compared by start/end values
2. ReservationSlot is a child entity inside Reservation — no independent lifecycle, always accessed through the aggregate
3. Overlap check is on the Reservation root — it owns all slots and can enforce consistency without external coordination
4. ReservationConfirmed event emitted — billing system needs to react to confirmations
5. Resource is referenced by ID only — separate aggregate with its own lifecycle
```

Keep decisions short. The full reasoning is in the conversation — the decision log captures the conclusion.

## Updating the Sketch

After each question round, update the sketch in-place. Do not create a new sketch — modify the existing one so the user sees a single evolving artifact. Highlight what changed: "Updated: moved Y from entity to value object inside X."

## Exit Condition

Move to Phase 3 when:
- You have no more genuine design questions, OR
- The user says to proceed, OR
- The user has made all the decisions listed in Open Questions

There is no minimum question count. If the requirement is clear and the sketch is unambiguous, zero questions is fine — just confirm and proceed.
