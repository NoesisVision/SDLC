namespace MyCompany.Sales;

[DddDomainEvent]
public delegate void OrderPlaced(int id);

[DddValueObject]
public enum OrderStatus
{
    Draft,
    Placed
}
