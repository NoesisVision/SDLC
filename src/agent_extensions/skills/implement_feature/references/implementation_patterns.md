# Implementation Patterns

## Domain Module Structure
- **First-level Domain Module** (DDD Bounded Context) = separate .NET project
- **Nested Domain Modules** = namespaces forming hierarchy
- **Namespace naming**: NEVER use architecture/pattern names (UseCases, Application, Adapters, Domain, Entities, Repositories, Services) or technical concerns (SQL, Messaging, Database)
- **Clean Architecture layers**: Mix in same namespace/project, NOT separated

## DDD Application Service (Handler)
Domain Behaviors tagged with EntryPoint.

```csharp
using MyCompany.ECommerce.Sales.Clients;
using MyCompany.ECommerce.Sales.Commons;
using MyCompany.ECommerce.Sales.Orders;
using MyCompany.ECommerce.Sales.Pricing;
using MyCompany.ECommerce.Sales.SalesChannels;
using MyCompany.ECommerce.Sales.Time;
using MyCompany.ECommerce.TechnicalStuff;
using MyCompany.ECommerce.TechnicalStuff.ProcessModel;
using NoesisVision.Annotations.Domain;
using NoesisVision.Annotations.People;
using NoesisVision.Annotations.Technology.CleanArchitecture;

namespace MyCompany.ECommerce.Sales.OnlineOrdering;

[UseCasesLayer]
public class PlaceOrderHandler(
    CalculatePrices calculatePrices,
    Order.Repository repository,
    Order.Factory factory,
    SalesCrudOperations crudOperations,
    OrderEventsOutbox eventsOutbox,
    Clock clock)
    : CommandHandler<PlaceOrder, OrderPlaced>
{
    [Actor(Actors.RetailClient)]
    [EntryPoint]
    public async Task<OrderPlaced> Handle(PlaceOrder command)
    {
            var (clientId, offer) = CreateDomainModelFrom(command);
            var currentOffer = await calculatePrices.For(clientId,
                SalesChannel.OnlineSale,
                offer.ProductAmounts,
                offer.Currency);
            if (!offer.Equals(currentOffer)) throw new DomainError();
            var order = factory.ImmediatelyPlacedBasedOn(offer);
            var orderHeader = new OrderHeader
            {
                Id = order.Id.Value, 
                ClientId = clientId.Value, 
                InvoicingDetails = command.InvoicingDetails
            };
            await repository.Save(order);
            await crudOperations.Create(orderHeader);
            var orderPlaced = CreateEventFrom(clientId, order, clock.Now);
            eventsOutbox.Add(orderPlaced);
            return orderPlaced;
        }

    private static (ClientId, Offer) CreateDomainModelFrom(PlaceOrder command) => (
        ClientId.From(command.ClientId),
        Offer.FromQuotes(command.CurrencyCode.ToDomainModel<Currency>(),
            command.Quotes.Select(quote => quote.ToDomainModel())));

    private static OrderPlaced CreateEventFrom(ClientId clientId, Order order, DateTime placedOn) =>
        new(order.Id.Value, clientId.Value, placedOn);
}
```

## DDD Aggregate
Domain Object tagged with DddAggregate.

```csharp
using NoesisVision.Annotations.Domain.DDD;
using NoesisVision.Annotations.Technology.CleanArchitecture;

namespace MyCompany.ECommerce.Sales.Orders;

[EntitiesLayer]
[DddAggregate]
public partial class Order : IEquatable<Order>, DataEquals<Order>
{
    public OrderId Id => _data.Id;
    ...
}
```

## DDD Domain Service
Domain Object tagged with DddDomainService.
Interface for policy abstraction when polymorphism is needed.

```csharp
namespace MyCompany.ECommerce.Sales.Orders.PriceChanges;

[EntitiesLayer]
[DddDomainService]
public interface PriceChangesPolicy
{
    bool CanChangePrices(ImmutableArray<Quote> oldQuotes, ImmutableArray<Quote> newQuotes);
}

[EntitiesLayer]
[DddDomainService]
public class AllowPriceChangesIfTotalPriceIsLower : PriceChangesPolicy
{
    public bool CanChangePrices(ImmutableArray<Quote> oldQuotes, ImmutableArray<Quote> newQuotes) =>
        GetTotalPrice(newQuotes) < GetTotalPrice(oldQuotes.Where(q => newQuotes.Contains(q)));

    private static Money GetTotalPrice(IEnumerable<Quote> quotes) => quotes
        .Select(quote => quote.Price)
        .Aggregate((totalPrice, price) => totalPrice + price);
}
```

## DDD Entity
Domain Object tagged with DddEntity.

```csharp
using MyCompany.ECommerce.Sales.Commons;
using MyCompany.ECommerce.Sales.Products;
using NoesisVision.Annotations.Domain.DDD;
using NoesisVision.Annotations.Technology.CleanArchitecture;

namespace MyCompany.ECommerce.Sales.Orders;

public partial class Order
{
    [EntitiesLayer]
    [DddEntity]
    public class Item : IEquatable<Item>
    {
        public ProductUnit Id => ProductAmount.ProductUnit;
        public ProductAmount ProductAmount { get; private set; }
        public PriceAgreement PriceAgreement { get; private set; }

        public Item(ProductAmount productAmount, PriceAgreement priceAgreement)
        {
            ProductAmount = productAmount;
            PriceAgreement = priceAgreement;
        }

        private Item() { }

        public static Item For(ProductAmount productAmount) => new(productAmount, PriceAgreement.Non());

        public void Add(ProductAmount productAmount)
        {
            ProductAmount += productAmount;
            PriceAgreement = PriceAgreement.Non();
        }

        public void ConfirmPrice(Money price) => PriceAgreement = PriceAgreement.Final(price);

        public void ConfirmPrice(Money price, DateTime expiresOn) =>
            PriceAgreement = PriceAgreement.Temporary(price, expiresOn);

        public bool Equals(Item? other) => other is not null && Id.Equals(other.Id);
    }
}
```

## DDD Factory
Domain Object tagged with DddFactory.
Create complex aggregates, choose policies.

Aggregate factory:
```csharp
[EntitiesLayer]
[DddFactory]
public abstract class Factory(RiskManagementIntegration riskManagement)
{
    public async Task<Order> NewWithMaxTotalCostFor(ClientId clientId)
    {
        var maxTotalCost = await riskManagement.GetMaxOrderTotalCostFor(clientId);
        return NewWith(maxTotalCost);
    }

    public Order ImmediatelyPlacedBasedOn(Offer offer)
    {
        var id = OrderId.New();
        var order = new Order(CreateData(id, offer.TotalPrice));
        foreach (var quote in offer.Quotes)
        {
            var item = Item.For(quote.ProductAmount);
            item.ConfirmPrice(quote.Price);
            order._data.Add(item);
        }
        order._data.IsPlaced = true;
        return order;
    }

    protected abstract Data CreateData(OrderId id, Money maxTotalCost);
}
```

Policy factory:
```csharp
using MyCompany.ECommerce.Sales.Clients;
using NoesisVision.Annotations.Domain.DDD;
using NoesisVision.Annotations.Technology.CleanArchitecture;

namespace MyCompany.ECommerce.Sales.Orders.PriceChanges;

[EntitiesLayer]
[DddFactory]
public class PriceChangesPolicies(
    AllowAnyPriceChanges allowAny,
    AllowPriceChangesIfTotalPriceIsLower allowIfTotalPriceIsLower,
    ClientRepository clients)
{
    public async Task<PriceChangesPolicy> ChooseFor(ClientId clientId)
    {
        var clientStatus = await clients.GetStatusFor(clientId);
        return clientStatus switch
        {
            ClientStatus.Normal => allowAny,
            ClientStatus.Vip => allowIfTotalPriceIsLower,
            _ => throw new ArgumentOutOfRangeException(nameof(clientStatus), clientStatus, null)
        };
    }
}
```

## DDD Repository
Domain Object tagged with DddRepository.
Interface only (implementation out of scope).
```csharp
using NoesisVision.Annotations.Domain.DDD;
using NoesisVision.Annotations.Technology.CleanArchitecture;

namespace MyCompany.ECommerce.Sales.Orders;

[EntitiesLayer]
[DddRepository]
public interface Repository
{
    Task<Order> GetBy(OrderId id);
    Task Save(Order order);
}
```

## DDD Value Object
Domain Object tagged with DddValueObject.
Immutable records/structs.

Simple example:
```csharp
[EntitiesLayer]
[DddValueObject]
public readonly record struct OrderId(Guid Value);
```

Complex example with operators:
```csharp
using System.Globalization;
using MyCompany.ECommerce.TechnicalStuff;
using NoesisVision.Annotations.Domain.DDD;
using NoesisVision.Annotations.Technology.CleanArchitecture;

namespace MyCompany.ECommerce.Sales.Commons;

[EntitiesLayer]
[DddValueObject]
public record Money(decimal Value, Currency Currency)
{
    public static Money Zero(Currency currency) => new(0, currency);
    public static Money Of(decimal value, Currency currency) => new(value, currency);

    public static Money operator +(Money x, Money y) => Calculate(x, y, (a, b) => a + b);
    public static Money operator -(Money x, Money y) => Calculate(x, y, (a, b) => a - b);

    private static Money Calculate(Money x, Money y, Func<decimal, decimal, decimal> calculate)
    {
        CheckCurrencies(x, y);
        return new Money(calculate(x.Value, y.Value), x.Currency);
    }

    public static Money operator *(Money x, int y) => Calculate(x, y, (a, b) => a * b);
    public static Money operator /(Money x, int y) => Calculate(x, y, (a, b) => a / b);
    public static Money operator *(Money x, decimal y) => Calculate(x, y, (a, b) => a * b);
    public static Money operator /(Money x, decimal y) => Calculate(x, y, (a, b) => a / b);

    public static Money operator *(Money x, Percentage y) => Calculate(x, y.Fraction, (a, b) => a * b);

    private static Money Calculate<T>(Money x, T y, Func<decimal, T, decimal> calculate) => 
        x with { Value = calculate(x.Value, y) };

    public static Percentage operator /(Money x, Money y)
    {
        CheckCurrencies(x, y);
        return Percentage.Of((int) Math.Round((x.Value / y.Value) * 100, 0));
    }

    public static Money Max(Money x, Money y) => x > y ? x : y;

    public static bool operator >(Money x, Money y) => Compare(x, y, (a, b) => a > b);
    public static bool operator <(Money x, Money y) => Compare(x, y, (a, b) => a < b);
    public static bool operator >=(Money x, Money y) => Compare(x, y, (a, b) => a >= b);
    public static bool operator <=(Money x, Money y) => Compare(x, y, (a, b) => a <= b);

    private static bool Compare(Money x, Money y, Func<decimal, decimal, bool> compare)
    {
        CheckCurrencies(x, y);
        return compare(x.Value, y.Value);
    }

    private static void CheckCurrencies(Money x, Money y)
    {
        if (x.Currency != y.Currency)
            throw new DomainError();
    }

    public override string ToString() =>
        $"{Value.ToString("F", CultureInfo.InvariantCulture)} {Currency.ToCode()}";
}
```