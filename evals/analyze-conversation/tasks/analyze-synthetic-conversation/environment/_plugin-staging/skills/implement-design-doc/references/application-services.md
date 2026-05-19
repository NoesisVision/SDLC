- An application service orchestrates one use case: load aggregate(s), invoke domain Behaviours, persist via repository, publish events.
- No domain rules here — they live in entities, value objects, aggregates, and domain services.
- Each Behaviour from the design doc maps to one public method.
- Annotate with `[DddApplicationService]` and `[UseCasesLayer]`; annotate each behaviour method with `[DomainBehavior]`.

```csharp
using NoesisVision.Annotations.Domain;
using NoesisVision.Annotations.Domain.DDD;
using NoesisVision.Annotations.Technology.CleanArchitecture;

[DddApplicationService]
[UseCasesLayer]
public class OrderApplicationService
{
    private readonly IOrderRepository _orders;
    private readonly IDomainEventBus _events;
    private readonly IUnitOfWork _uow;

    public OrderApplicationService(IOrderRepository orders, IDomainEventBus events, IUnitOfWork uow)
    {
        _orders = orders;
        _events = events;
        _uow = uow;
    }

    [DomainBehavior]
    public async Task Confirm(ConfirmOrder command, CancellationToken ct)
    {
        var order = await _orders.GetById(command.OrderId, ct)
            ?? throw new DomainException("Order not found.");
        order.Confirm();
        await _uow.SaveChanges(ct);
        await _events.Publish(order.Events, ct);
    }
}
```
