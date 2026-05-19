- A repository port is a domain-shaped, collection-like contract for one aggregate.
- Method names are intent-revealing (`Add`, `GetById`, `FindOpenForCustomer`); they accept and return aggregates and value objects.
- The interface lives in the domain — no leaking of storage or framework types.
- Carries no business rules.
- Annotate the interface with `[DddRepository]` and `[EntitiesLayer]`.

```csharp
using NoesisVision.Annotations.Domain.DDD;
using NoesisVision.Annotations.Technology.CleanArchitecture;

[DddRepository]
[EntitiesLayer]
public interface IOrderRepository
{
    Task<Order?> GetById(OrderId id, CancellationToken ct);
    Task Add(Order order, CancellationToken ct);
    Task<IReadOnlyList<Order>> FindOpenForCustomer(CustomerId customerId, CancellationToken ct);
}
```
