- A domain command is an imperative request to change state, named in imperative form (e.g. `ConfirmOrder`).
- Carries inputs only — no behaviour, no state.
- Use a sealed record with required init properties.
- Prefer value objects over primitives.
- Annotate with `[Command]` and `[EntitiesLayer]`.

```csharp
using NoesisVision.Annotations.Domain;
using NoesisVision.Annotations.Technology.CleanArchitecture;

[Command]
[EntitiesLayer]
public sealed record ConfirmOrder(OrderId OrderId);
```
