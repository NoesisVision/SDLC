# Domain Model Anti-Patterns

Things Claude tends to do wrong in domain model generation without explicit guidance. Check each one during Phase 3 implementation and Phase 4 verification.

## 1. Anemic Domain Model

**What it looks like:** Entity classes that are just property bags. All logic lives in services.

```csharp
// BAD: Anemic
public class Reservation
{
    public Guid Id { get; set; }
    public string Status { get; set; }
    public List<ReservationSlot> Slots { get; set; } = new();
}

public class ReservationService
{
    public void Confirm(Reservation reservation)
    {
        if (reservation.Status != "Draft") throw new Exception("...");
        if (!reservation.Slots.Any()) throw new Exception("...");
        reservation.Status = "Confirmed";
    }
}
```

```csharp
// GOOD: Rich domain model
public class Reservation
{
    public void Confirm()
    {
        if (Status != ReservationStatus.Draft)
            throw new DomainException("Can only confirm draft reservations");
        if (!_slots.Any())
            throw new DomainException("Cannot confirm without slots");
        Status = ReservationStatus.Confirmed;
        _domainEvents.Add(new ReservationConfirmed(Id, DateTime.UtcNow));
    }
}
```

**Test:** Every entity and aggregate root should have at least one method with business logic. If a class has only properties — it's either a value object (make it one) or it's anemic (add behavior).

## 2. Public Setters on Domain State

**What it looks like:** Properties with `{ get; set; }` that allow bypassing invariants.

```csharp
// BAD: Anyone can set Status directly, skipping validation
public ReservationStatus Status { get; set; }

// GOOD: State changes only through methods that enforce rules
public ReservationStatus Status { get; private set; }
```

**Test:** Search generated code for `{ get; set; }` on any property that represents domain state. Every one is a potential invariant bypass. Use `{ get; private set; }` or `{ get; private init; }`.

## 3. Exposed Mutable Collections

**What it looks like:** Returning `List<T>` directly, allowing external code to add/remove items without the aggregate's knowledge.

```csharp
// BAD: External code can add slots bypassing overlap check
public List<ReservationSlot> Slots { get; } = new();

// GOOD: Read-only view, modifications only through aggregate methods
private readonly List<ReservationSlot> _slots = new();
public IReadOnlyCollection<ReservationSlot> Slots => _slots.AsReadOnly();
```

**Test:** Every collection property on an aggregate should return `IReadOnlyCollection<T>`, `IReadOnlyList<T>`, or `IEnumerable<T>`. The mutable backing field should be private.

## 4. Object References Between Aggregates

**What it looks like:** One aggregate holds a navigation property to another aggregate.

```csharp
// BAD: Reservation holds a reference to Resource object
public Resource Resource { get; private set; }

// GOOD: Reference by ID only
public Guid ResourceId { get; private init; }
```

**Why it matters:** Object references create implicit coupling, break aggregate isolation, and make it unclear which aggregate is responsible for loading and saving the other.

**Test:** No aggregate class should have a property whose type is another aggregate root class.

## 5. Validation in Wrong Place

**What it looks like:** Invariant checks in constructors when they should be in factory methods or behavior methods, or in external services when they should be on the entity.

```csharp
// BAD: Complex creation rules buried in constructor
public Reservation(Guid id, Guid resourceId, List<TimeRange> initialSlots)
{
    // 20 lines of validation...
}

// GOOD: Factory method makes complex creation explicit
public static Reservation Create(Guid resourceId)
{
    return new Reservation
    {
        Id = ReservationId.New(),
        ResourceId = resourceId,
        Status = ReservationStatus.Draft
    };
}
```

**Guideline:**
- **Value object constructor:** validate own invariants (e.g., Money amount >= 0)
- **Entity/aggregate factory method:** validate creation rules
- **Aggregate behavior method:** validate state transition rules
- **Domain service:** validate rules that span multiple aggregates

## 6. Speculative Methods

**What it looks like:** Methods added because they "might be needed" without a caller in the current scope.

```csharp
// BAD: Added speculatively
public void Archive() { /* nobody calls this yet */ }
public Reservation Clone() { /* no use case for this */ }
public decimal CalculateTotalDuration() { /* not in requirements */ }
```

**Rule:** Every method must be either called by a test (proving an invariant or behavior from the sketch) or called by another method in the domain model. Delete anything else.

## 7. Stringly-Typed Domain Concepts

**What it looks like:** Using `string` or `Guid` for concepts that have rules.

```csharp
// BAD: Currency is just a string, email is just a string
public string Currency { get; set; }
public string Email { get; set; }

// GOOD: Value objects with validation
public record Currency
{
    public string Code { get; }
    public Currency(string code)
    {
        if (code.Length != 3) throw new ArgumentException("ISO currency code required");
        Code = code.ToUpperInvariant();
    }
}
```

**Test:** If a string or primitive has validation rules, format constraints, or appears in multiple places, it should be a value object.

## 8. Domain Events Carrying Too Much or Too Little

**What it looks like:** Events that include the entire aggregate state (coupling consumers to the model) or events that carry only an ID (forcing consumers to load the aggregate).

```csharp
// BAD: Too much — couples consumers to aggregate internals
public record ReservationConfirmed(Reservation FullReservation, DateTime OccurredAt);

// BAD: Too little — consumers can't do anything useful
public record ReservationConfirmed(Guid ReservationId);

// GOOD: Key data consumers need without internal coupling
public record ReservationConfirmed(
    ReservationId ReservationId,
    Guid ResourceId,
    int SlotCount,
    DateTime OccurredAt
) : IDomainEvent;
```

**Guideline:** Include the aggregate ID, the key facts about what happened, and a timestamp. Don't include the aggregate itself or its full state.

## 9. Repository Interface Bloat

**What it looks like:** Repository interfaces with many query methods that bypass aggregate boundaries.

```csharp
// BAD: Query methods that bypass the aggregate
public interface IReservationRepository
{
    Task<Reservation?> GetByIdAsync(ReservationId id);
    Task SaveAsync(Reservation reservation);
    Task<List<ReservationSlot>> GetSlotsByResourceAsync(Guid resourceId);  // Bypasses aggregate
    Task<List<Reservation>> GetByDateRangeAsync(DateTime from, DateTime to);  // Read concern
    Task<int> CountByStatusAsync(ReservationStatus status);  // Read concern
}

// GOOD: Only what the domain needs for writes
public interface IReservationRepository
{
    Task<Reservation?> GetByIdAsync(ReservationId id, CancellationToken ct = default);
    Task SaveAsync(Reservation reservation, CancellationToken ct = default);
}
```

**Rule:** Repository interfaces in the domain layer serve aggregate loading and saving. Query methods that serve read/display concerns belong in a separate read model or query service.

## Quick Checklist

Run through this before finishing Phase 3 and again in Phase 4:

- [ ] No `{ get; set; }` on domain state properties
- [ ] No `List<T>` exposed publicly on aggregates
- [ ] No aggregate holds an object reference to another aggregate
- [ ] Every entity/aggregate has behavior methods, not just properties
- [ ] Every method is called by something (no speculative code)
- [ ] Value objects validate their own constraints
- [ ] Domain events have ID + key data + timestamp, not full aggregate state
- [ ] Repository interfaces have only load/save, no query methods
