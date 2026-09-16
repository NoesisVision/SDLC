namespace MyCompany.Sales;

[DddAggregate]
public class Order
{
    public void Confirm() {}

    [DomainBehavior("Cancel order")]
    public void Cancel() {}

    private void Internal() {}
}
