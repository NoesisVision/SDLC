- An external-integration adapter implements the port by calling the target module's command/query handler directly (in-process, modular monolith).
- The adapter translates the other module's DTOs and exceptions into domain types and domain exceptions; nothing from the other module leaks beyond it.
- No HTTP or message-bus transport — these are in-process integrations for now.
- Annotate with `[ExternalSystemIntegration("<other-module-name>")]` and `[AdaptersLayer]`.

```csharp
using NoesisVision.Annotations.Domain;
using NoesisVision.Annotations.Technology.CleanArchitecture;
using Billing.PublicApi;

[ExternalSystemIntegration("Billing")]
[AdaptersLayer]
public class BillingGateway : IBillingGateway
{
    private readonly IIssueInvoiceHandler _handler;

    public BillingGateway(IIssueInvoiceHandler handler) => _handler = handler;

    public async Task<InvoiceId> IssueInvoice(OrderId orderId, Money total, CancellationToken ct)
    {
        try
        {
            var result = await _handler.Handle(
                new IssueInvoiceCommand(orderId.Value, total.Amount, total.Currency),
                ct);
            return new InvoiceId(result.InvoiceId);
        }
        catch (BillingValidationException ex)
        {
            throw new DomainException($"Billing rejected the invoice: {ex.Message}");
        }
    }
}
```
