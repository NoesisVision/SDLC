namespace MyCompany.Sales;

[DddAggregate]
public partial class Order<T> : Aggregate<T>, IEquatable<Order<T>> where T : class
{
    public void Confirm() { }
}
