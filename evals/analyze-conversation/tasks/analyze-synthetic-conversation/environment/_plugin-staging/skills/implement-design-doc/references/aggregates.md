- An aggregate is a cluster of objects treated as one unit; the root is the only entry point.
- The root has a stable identity; equality is by id.
- All state changes go through public methods on the root that implement Behaviours; no public setters.
- Invariants spanning the cluster are enforced inside those methods.
- The root records domain events; the application service publishes them after persistence.
- Annotate the root with `[DddAggregate]` and `[EntitiesLayer]`; annotate each behaviour method with `[DomainBehavior]`.

```csharp
using NoesisVision.Annotations.Domain;
using NoesisVision.Annotations.Domain.DDD;
using NoesisVision.Annotations.Technology.CleanArchitecture;

[DddAggregate]
[EntitiesLayer]
public class Order
{
    private readonly List<OrderLine> _lines = new();
    private readonly List<IDomainEvent> _events = new();

    public OrderId Id { get; }
    public CustomerId CustomerId { get; }
    public OrderStatus Status { get; private set; }
    public IReadOnlyCollection<OrderLine> Lines => _lines;
    public IReadOnlyCollection<IDomainEvent> Events => _events;

    public Order(OrderId id, CustomerId customerId)
    {
        Id = id;
        CustomerId = customerId;
        Status = OrderStatus.Draft;
    }

    [DomainBehavior]
    public void AddLine(ProductId productId, Quantity quantity, Money unitPrice)
    {
        if (Status != OrderStatus.Draft) throw new DomainException("Cannot modify a confirmed order.");
        _lines.Add(new OrderLine(OrderLineId.New(), productId, quantity, unitPrice));
    }

    [DomainBehavior]
    public void Confirm()
    {
        if (_lines.Count == 0) throw new DomainException("Order must have at least one line.");
        Status = OrderStatus.Confirmed;
        _events.Add(new OrderConfirmed(Id));
    }
}
```
