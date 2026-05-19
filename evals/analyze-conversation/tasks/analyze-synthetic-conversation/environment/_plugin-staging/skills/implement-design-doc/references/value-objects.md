- A value object has no identity; equality is by structural value.
- Immutable — properties use `init` or are set only in the constructor.
- Validate invariants on construction; throw a domain exception on violation.
- Prefer nested value objects over primitives.
- Operations return new instances; never mutate.
- Annotate with `[DddValueObject]` and `[EntitiesLayer]`.

```csharp
using NoesisVision.Annotations.Domain;
using NoesisVision.Annotations.Domain.DDD;
using NoesisVision.Annotations.Technology.CleanArchitecture;

[DddValueObject]
[EntitiesLayer]
public sealed record Money
{
    public decimal Amount { get; init; }
    public string Currency { get; init; }

    public Money(decimal amount, string currency)
    {
        if (amount < 0) throw new DomainException("Amount cannot be negative.");
        if (string.IsNullOrWhiteSpace(currency)) throw new DomainException("Currency is required.");
        Amount = amount;
        Currency = currency;
    }

    public Money Add(Money other)
    {
        if (Currency != other.Currency) throw new DomainException("Currency mismatch.");
        return new Money(Amount + other.Amount, Currency);
    }

    public Money Multiply(Quantity quantity) => new(Amount * quantity.Value, Currency);
}
```
