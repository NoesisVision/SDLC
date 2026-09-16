namespace MyCompany.Sales;

[DddApplicationService]
public class OrderApi
{
    [Actor("Customer")]
    public void Place() { }

    [DomainBehavior("Cancel Order")]
    [ActorAttribute("Approving Manager")]
    public void Cancel() { }

    public void NoActor() { }
}
