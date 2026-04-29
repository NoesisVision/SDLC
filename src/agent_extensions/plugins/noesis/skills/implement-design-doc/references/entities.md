- An entity has a stable identity that does not change; equality is by id.
- Properties expose public getters only; never expose public setters.
- All state changes go through methods that implement Behaviours from the design doc.
- Invariants are enforced inside those methods, never via setters.
- Prefer value objects over primitives for properties.
- Annotate the type with `[DddEntity]` and `[EntitiesLayer]`; annotate each behaviour method with `[DomainBehavior]`.

```csharp
using NoesisVision.Annotations.Domain;
using NoesisVision.Annotations.Domain.DDD;
using NoesisVision.Annotations.Technology.CleanArchitecture;

[DddEntity]
[EntitiesLayer]
public class OrderLine
{
    public OrderLineId Id { get; }
    public ProductId ProductId { get; }
    public Quantity Quantity { get; private set; }
    public Money UnitPrice { get; }

    public OrderLine(OrderLineId id, ProductId productId, Quantity quantity, Money unitPrice)
    {
        Id = id;
        ProductId = productId;
        Quantity = quantity;
        UnitPrice = unitPrice;
    }

    public Money LineTotal => UnitPrice.Multiply(Quantity);

    [DomainBehavior]
    public void ChangeQuantity(Quantity newQuantity)
    {
        if (newQuantity.IsZero) throw new DomainException("Quantity must be greater than zero.");
        Quantity = newQuantity;
    }
}
```
