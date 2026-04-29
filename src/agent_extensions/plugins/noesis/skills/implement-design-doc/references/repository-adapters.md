- A repository adapter implements the port using EF Core.
- Constructor injects the EF `DbContext`; the adapter participates in the application-service unit-of-work.
- Map between the EF persistence model and the aggregate; never leak EF types beyond the adapter.
- Annotate with `[DddRepository]` and `[AdaptersLayer]`.

```csharp
using Microsoft.EntityFrameworkCore;
using NoesisVision.Annotations.Domain.DDD;
using NoesisVision.Annotations.Technology.CleanArchitecture;

[DddRepository]
[AdaptersLayer]
public class OrderRepository : IOrderRepository
{
    private readonly OrdersDbContext _db;

    public OrderRepository(OrdersDbContext db) => _db = db;

    public Task<Order?> GetById(OrderId id, CancellationToken ct) =>
        _db.Orders
            .Include(o => o.Lines)
            .FirstOrDefaultAsync(o => o.Id == id, ct);

    public async Task Add(Order order, CancellationToken ct) =>
        await _db.Orders.AddAsync(order, ct);

    public async Task<IReadOnlyList<Order>> FindOpenForCustomer(CustomerId customerId, CancellationToken ct) =>
        await _db.Orders
            .Where(o => o.CustomerId == customerId && o.Status == OrderStatus.Draft)
            .ToListAsync(ct);
}
```
