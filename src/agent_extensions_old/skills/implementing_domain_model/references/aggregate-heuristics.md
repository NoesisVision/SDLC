# Aggregate Boundary Heuristics

Decision framework for the hardest question in domain modeling: what belongs together in one aggregate and what gets its own aggregate?

## The Core Test: Transactional Consistency

Ask: "Must these two things change together in a single transaction to keep the system correct?"

- **Yes** → same aggregate
- **No** → separate aggregates, reference by ID

Most boundary mistakes come from conflating "related" with "must be consistent." Orders and Customers are deeply related but almost never need to change in the same transaction.

## Decision Signals

### Signals That Suggest ONE Aggregate

- **Invariant spans both concepts.** "A reservation cannot have overlapping slots" — the reservation must see all its slots to enforce this. Slots belong inside the Reservation aggregate.
- **Lifecycle coupling.** The child has no meaning without the parent. Deleting the parent should delete the child. An order line has no meaning without its order.
- **No independent access needed.** Nothing in the system needs to load a child entity without going through the parent. No one queries "all slots across all reservations."
- **Small in number.** The child collection is bounded (typically < 20-30 items). A reservation has a handful of slots, not thousands.

### Signals That Suggest SEPARATE Aggregates

- **Independent lifecycle.** The "child" gets created, modified, or deleted independently of the "parent." A Product exists before and after an Order references it.
- **Referenced by multiple parents.** If multiple aggregates need to reference the same thing, it's probably its own aggregate. A Resource is referenced by many Reservations.
- **Unbounded collection.** If a parent could have thousands of children (e.g., a Customer with Orders), the children should be separate aggregates. Loading all of them would be impractical.
- **Different change frequency.** The "parent" changes rarely but the "child" changes constantly, or vice versa. Separate aggregates avoid unnecessary concurrency conflicts.
- **Different team ownership.** If different teams are responsible for the two concepts, separate aggregates (and possibly separate bounded contexts) reduce coordination cost.

## Common Boundary Mistakes

### Mistake: Too-Large Aggregates

**Symptom:** An aggregate with 5+ entity types, 10+ value objects, or collections that could grow unbounded.

**Why it happens:** Treating the aggregate as a container for everything related, rather than a consistency boundary.

**Fix:** Split along invariant lines. Each aggregate enforces its own invariants. Cross-aggregate rules become domain services or eventual consistency.

### Mistake: Too-Small Aggregates

**Symptom:** Every entity is its own aggregate. Simple operations require coordinating 4-5 aggregates. Many domain services exist just to keep things in sync.

**Why it happens:** Applying "separate aggregates" dogmatically without checking if the separation adds value.

**Fix:** If two aggregates always change together in practice, merge them. The overhead of coordination outweighs the theoretical purity.

### Mistake: Aggregate as Query Boundary

**Symptom:** Aggregate is designed around what the UI needs to display, not around what needs to be consistent.

**Why it happens:** Confusing "what I need to show on this page" with "what must be consistent."

**Fix:** Aggregates serve write-side consistency. Read-side concerns (what to display) are served by projections, read models, or queries that can cross aggregate boundaries freely.

## ID Reference Patterns

When aggregates reference each other by ID:

```
// Inside Reservation aggregate
public Guid ResourceId { get; private init; }  // Just the ID

// NOT this:
public Resource Resource { get; }  // Object reference — breaks aggregate isolation
```

If you need data from the other aggregate during a domain operation, pass it as a method parameter:

```csharp
// Domain service receives both, coordinates
public bool IsAvailable(Resource resource, TimeRange range, IReadOnlyCollection<Reservation> existing)
```

Do not make one aggregate load another through a repository. That's application layer work.

## Practical Sizing Guide

| Aggregate Size | Typical Shape | Watch Out For |
|---|---|---|
| 1 root + 0-2 value objects | Simple entity (e.g., Resource, User) | Might be too anemic — check if behaviors are missing |
| 1 root + 1-3 child entities + 2-5 value objects | Standard aggregate (e.g., Order with OrderLines) | Sweet spot for most domains |
| 1 root + 4+ child entities + 5+ value objects | Complex aggregate (e.g., Insurance Policy) | Verify every child truly requires same-transaction consistency |
| 1 root + unbounded collection | **Redesign.** The collection items should be their own aggregate | e.g., don't put all Transactions inside Account |
