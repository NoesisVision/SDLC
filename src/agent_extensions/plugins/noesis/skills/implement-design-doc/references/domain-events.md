- A domain event is an immutable record of something that happened, named in past tense (e.g. `OrderConfirmed`).
- Use a sealed record with the minimum payload subscribers need.
- Include identifying data and an `OccurredAt` timestamp.
- Annotate with `[DddDomainEvent]` and `[EntitiesLayer]`.

```csharp
using NoesisVision.Annotations.Domain.DDD;
using NoesisVision.Annotations.Technology.CleanArchitecture;

[DddDomainEvent]
[EntitiesLayer]
public sealed record OrderConfirmed(OrderId OrderId, DateTimeOffset OccurredAt) : IDomainEvent
{
    public OrderConfirmed(OrderId orderId) : this(orderId, DateTimeOffset.UtcNow) { }
}
```
