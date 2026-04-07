# C# Domain Model Idioms

Concrete patterns for each domain concept. Use as defaults when the project has no existing conventions. If the project already has domain classes, match their style instead.

## Value Object

Use C# `record` for automatic value equality. Validate in constructor.

```csharp
public record Money
{
    public decimal Amount { get; }
    public string Currency { get; }

    public Money(decimal amount, string currency)
    {
        if (amount < 0) throw new ArgumentException("Amount cannot be negative", nameof(amount));
        if (string.IsNullOrWhiteSpace(currency)) throw new ArgumentException("Currency required", nameof(currency));
        Amount = amount;
        Currency = currency.ToUpperInvariant();
    }

    public Money Add(Money other)
    {
        if (Currency != other.Currency) throw new InvalidOperationException($"Cannot add {Currency} and {other.Currency}");
        return new Money(Amount + other.Amount, Currency);
    }
}
```

**Key points:**
- Immutable — all properties `get`-only
- Self-validating constructor
- Behavior lives on the value object when it's about that value (Money knows how to add Money)
- No ID property
- Use `record` (C# 9+) or override `Equals`/`GetHashCode` manually for older targets

### Single-Value Wrapper

For strongly typed IDs or constrained primitives:

```csharp
public record ReservationId(Guid Value)
{
    public static ReservationId New() => new(Guid.NewGuid());
}

public record EmailAddress
{
    public string Value { get; }
    public EmailAddress(string value)
    {
        if (!value.Contains('@')) throw new ArgumentException("Invalid email", nameof(value));
        Value = value.Trim().ToLowerInvariant();
    }
}
```

## Entity

Class with identity. Equals by ID, not by attributes.

```csharp
public class ReservationSlot
{
    public Guid Id { get; private init; }
    public TimeRange TimeRange { get; private set; }
    public string? Notes { get; private set; }

    internal ReservationSlot(Guid id, TimeRange timeRange, string? notes = null)
    {
        Id = id;
        TimeRange = timeRange ?? throw new ArgumentNullException(nameof(timeRange));
        Notes = notes;
    }

    internal void Reschedule(TimeRange newTimeRange)
    {
        TimeRange = newTimeRange ?? throw new ArgumentNullException(nameof(newTimeRange));
    }

    // Prevent external construction — only the aggregate root creates child entities
    private ReservationSlot() { } // For ORM
}
```

**Key points:**
- `internal` constructor — only the owning aggregate creates it
- `private set` — state changes through named methods
- Parameterless constructor for ORM if needed (private)
- No public method that bypasses the aggregate root's invariants

## Aggregate Root

Owns child entities, enforces invariants, emits domain events.

```csharp
public class Reservation
{
    private readonly List<ReservationSlot> _slots = new();
    private readonly List<IDomainEvent> _domainEvents = new();

    public ReservationId Id { get; private init; }
    public Guid ResourceId { get; private init; }  // Reference to another aggregate by ID
    public ReservationStatus Status { get; private set; }
    public IReadOnlyCollection<ReservationSlot> Slots => _slots.AsReadOnly();
    public IReadOnlyCollection<IDomainEvent> DomainEvents => _domainEvents.AsReadOnly();

    // Factory method — preferred over public constructor for complex creation logic
    public static Reservation Create(ReservationId id, Guid resourceId)
    {
        return new Reservation
        {
            Id = id,
            ResourceId = resourceId,
            Status = ReservationStatus.Draft
        };
    }

    // Behavior with invariant enforcement
    public void AddSlot(TimeRange timeRange, string? notes = null)
    {
        if (Status != ReservationStatus.Draft)
            throw new DomainException("Can only add slots to draft reservations");

        // Invariant: slots cannot overlap
        if (_slots.Any(s => s.TimeRange.OverlapsWith(timeRange)))
            throw new DomainException("Slot overlaps with existing slot");

        _slots.Add(new ReservationSlot(Guid.NewGuid(), timeRange, notes));
    }

    public void Confirm()
    {
        if (Status != ReservationStatus.Draft)
            throw new DomainException("Can only confirm draft reservations");
        if (!_slots.Any())
            throw new DomainException("Cannot confirm reservation with no slots");

        Status = ReservationStatus.Confirmed;
        _domainEvents.Add(new ReservationConfirmed(Id, ResourceId, DateTime.UtcNow));
    }

    public void ClearDomainEvents() => _domainEvents.Clear();

    private Reservation() { } // For ORM
}
```

**Key points:**
- Collections exposed as `IReadOnlyCollection` — mutable list is private
- Child entities created only through aggregate methods (not directly)
- Cross-aggregate references by ID (`Guid ResourceId`), never by object
- Factory method instead of public constructor when creation has rules
- Domain events collected internally, cleared after dispatch
- Invariant checks in every mutating method

## Domain Event

Immutable record with past-tense naming. Carries enough data to be useful without requiring the consumer to load the aggregate.

```csharp
public interface IDomainEvent
{
    DateTime OccurredAt { get; }
}

public record ReservationConfirmed(
    ReservationId ReservationId,
    Guid ResourceId,
    DateTime OccurredAt
) : IDomainEvent;
```

## Domain Service

Coordinates logic that doesn't belong to a single aggregate. Receives aggregates (or their data) as parameters — does not own state.

```csharp
public class AvailabilityChecker
{
    /// <summary>
    /// Design decision: cross-aggregate availability rule lives here
    /// because it requires data from both Reservation and Resource aggregates.
    /// </summary>
    public bool IsResourceAvailable(
        Guid resourceId,
        TimeRange requestedRange,
        IReadOnlyCollection<Reservation> existingReservations)
    {
        return !existingReservations
            .Where(r => r.ResourceId == resourceId && r.Status == ReservationStatus.Confirmed)
            .SelectMany(r => r.Slots)
            .Any(slot => slot.TimeRange.OverlapsWith(requestedRange));
    }
}
```

**Key points:**
- No injected repositories or services — pure domain logic
- Takes data as parameters, returns a result
- Stateless — no fields, no constructor dependencies
- If it needs to load aggregates, that's the application layer's job

## Repository Interface

Defined in the domain layer. Implementation lives elsewhere (infrastructure).

```csharp
public interface IReservationRepository
{
    Task<Reservation?> GetByIdAsync(ReservationId id, CancellationToken ct = default);
    Task SaveAsync(Reservation reservation, CancellationToken ct = default);
}
```

**Key points:**
- Returns domain objects, not DTOs
- Only methods the domain actually needs (not a generic CRUD interface)
- Async with CancellationToken
- No query methods that bypass the aggregate (no `GetSlotsByTimeRange` — load the aggregate)

## Domain Exception

Specific exception for domain rule violations, distinct from infrastructure or argument errors.

```csharp
public class DomainException : Exception
{
    public DomainException(string message) : base(message) { }
}
```

Keep it simple. Add subclasses only if consumers need to catch specific domain errors differently.

## Enum / Status as Value Object

For simple statuses, a C# enum is fine. For statuses with behavior, use a value object or smart enum.

```csharp
// Simple — use when status is just a label
public enum ReservationStatus { Draft, Confirmed, Cancelled }

// Rich — use when status has transition rules or associated behavior
public record ReservationStatus
{
    public static readonly ReservationStatus Draft = new("Draft");
    public static readonly ReservationStatus Confirmed = new("Confirmed");
    public static readonly ReservationStatus Cancelled = new("Cancelled");

    public string Value { get; }
    private ReservationStatus(string value) => Value = value;

    public bool CanTransitionTo(ReservationStatus target) =>
        (this, target) switch
        {
            _ when this == Draft && target == Confirmed => true,
            _ when this == Draft && target == Cancelled => true,
            _ when this == Confirmed && target == Cancelled => true,
            _ => false
        };
}
```

Prefer the simple enum unless transition rules are complex enough to warrant the value object.

## Shared Kernel Base Classes

Only create these if the project doesn't already have them. If it does, use the existing ones.

```csharp
public abstract class Entity<TId> where TId : notnull
{
    public TId Id { get; protected init; } = default!;

    public override bool Equals(object? obj) =>
        obj is Entity<TId> other && Id.Equals(other.Id);

    public override int GetHashCode() => Id.GetHashCode();
}
```

Keep base classes minimal. Do not add helper methods "for convenience" — they accumulate and couple everything to the base.
