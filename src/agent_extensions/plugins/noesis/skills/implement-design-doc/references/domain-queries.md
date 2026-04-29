- A domain query is a read-only request that does not change state.
- Name it as a noun + filter (e.g. `OpenOrdersForCustomer`).
- Use a sealed record with required filter fields; prefer value objects over primitives.
- Annotate with `[Query]` and `[EntitiesLayer]`.

```csharp
using NoesisVision.Annotations.Domain;
using NoesisVision.Annotations.Technology.CleanArchitecture;

[Query]
[EntitiesLayer]
public sealed record OpenOrdersForCustomer(CustomerId CustomerId);
```
