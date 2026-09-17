namespace MyCompany.Sales;

[DddAggregate]
public class Cart
{
    [DomainBehavior]
    public void AddItem() { }

    [DomainBehaviorAttribute("Empty the cart")]
    public void Clear() { }
}
