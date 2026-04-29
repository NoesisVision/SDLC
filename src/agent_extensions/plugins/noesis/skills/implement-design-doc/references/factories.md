- A factory encapsulates the complex creation of an aggregate or value object.
- Enforce invariants before returning the new object.
- Take the smallest input set needed to produce a fully-initialised target.
- Static class with `Create...` methods is fine; use an instance class only when creation needs collaborators.
- Annotate with `[DddFactory]` and `[EntitiesLayer]`.

```csharp
using NoesisVision.Annotations.Domain.DDD;
using NoesisVision.Annotations.Technology.CleanArchitecture;

[DddFactory]
[EntitiesLayer]
public class OrderFactory
{
    public Order CreateDraft(
        CustomerId customerId,
        IEnumerable<(ProductId Product, Quantity Quantity, Money UnitPrice)> items)
    {
        var order = new Order(OrderId.New(), customerId);
        foreach (var (product, quantity, unitPrice) in items)
            order.AddLine(product, quantity, unitPrice);
        return order;
    }
}
```
