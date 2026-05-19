- One C# project per Bounded Context; nested Modules become subdirectories under that project.
- All Clean Architecture layers (entities, use cases, adapters, framework wiring) live together in the same project — separated by directory and by layer annotation, not by project.
- Every type carries a layer annotation: `[EntitiesLayer]`, `[UseCasesLayer]`, `[AdaptersLayer]`, or `[FrameworkLayer]`.
- A Bounded Context project may reference shared kernels and other contexts' public-API contracts; never another context's internals.
- Annotate the context's marker class with `[DddBoundedContext]`.

```csharp
using NoesisVision.Annotations.Domain.DDD;

[DddBoundedContext("Sales")]
public sealed class SalesContext { }
```

```
Sales/                              # one C# project = one Bounded Context
├── Sales.csproj
├── SalesContext.cs                 # [DddBoundedContext]
├── Orders/                         # nested Module
│   ├── Order.cs                    # [DddAggregate, EntitiesLayer]
│   ├── OrderLine.cs                # [DddEntity, EntitiesLayer]
│   ├── ConfirmOrder.cs             # [Command, EntitiesLayer]
│   ├── OrderConfirmed.cs           # [DddDomainEvent, EntitiesLayer]
│   ├── IOrderRepository.cs         # [DddRepository, EntitiesLayer]
│   ├── IBillingGateway.cs          # [ExternalSystemIntegration, EntitiesLayer]
│   ├── OrderApplicationService.cs  # [DddApplicationService, UseCasesLayer]
│   ├── OrderRepository.cs          # [DddRepository, AdaptersLayer]   — EF Core
│   └── BillingGateway.cs           # [ExternalSystemIntegration, AdaptersLayer]
└── Pricing/                        # nested Module
    └── PricingService.cs           # [DddDomainService, EntitiesLayer]
```
