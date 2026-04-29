- A domain service holds stateless domain operations that don't naturally belong to an entity or value object.
- Inputs and outputs are domain types; no infrastructure concerns.
- Each Behaviour from the design doc maps to one method.
- Pure where possible.
- Annotate with `[DddDomainService]` and `[EntitiesLayer]`; annotate each behaviour method with `[DomainBehavior]`.

```csharp
using NoesisVision.Annotations.Domain;
using NoesisVision.Annotations.Domain.DDD;
using NoesisVision.Annotations.Technology.CleanArchitecture;

[DddDomainService]
[EntitiesLayer]
public class PricingService
{
    [DomainBehavior]
    public Money CalculateTotal(IReadOnlyCollection<OrderLine> lines, DiscountPolicy policy)
    {
        var subtotal = lines
            .Select(l => l.LineTotal)
            .Aggregate((a, b) => a.Add(b));
        return policy.Apply(subtotal);
    }
}
```
