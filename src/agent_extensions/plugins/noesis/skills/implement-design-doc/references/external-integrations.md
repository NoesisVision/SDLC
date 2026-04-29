- An external-integration port is a domain-shaped contract for an outbound dependency.
- In our modular monolith, "external" means another module — the adapter calls that module's command/query handler.
- The interface uses domain types; it does not expose transport, message-bus, or other-module internals.
- Carries no business rules.
- Annotate the interface with `[ExternalSystemIntegration("<other-module-name>")]` and `[EntitiesLayer]`.

```csharp
using NoesisVision.Annotations.Domain;
using NoesisVision.Annotations.Technology.CleanArchitecture;

[ExternalSystemIntegration("Billing")]
[EntitiesLayer]
public interface IBillingGateway
{
    Task<InvoiceId> IssueInvoice(OrderId orderId, Money total, CancellationToken ct);
}
```
