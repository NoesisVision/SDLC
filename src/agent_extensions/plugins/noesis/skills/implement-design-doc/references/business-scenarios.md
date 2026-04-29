- Every `Rule` from the design doc is exercised by at least one business-scenario test.
- The test attaches at the level the design doc specifies: Behaviour → end-to-end test of that method; Building Block → test across multiple Behaviours; Rule → single transition.
- Use xUnit; mirror `src` directory structure under `tests`.
- Map Given/When/Then directly to Arrange/Act/Assert; one design-doc scenario maps to one test method, named after the scenario.
- Use deterministic builders; never randomness.
- Annotate the test class or method with `[Scenario("<scenario name>")]`.
- Never invent scenarios that aren't in the design doc; never weaken assertions to make a test pass — fix the implementation.

```csharp
using NoesisVision.Annotations.Domain;
using Xunit;

public class OrderConfirmationScenarios
{
    [Fact]
    [Scenario("Confirming an order with no lines fails")]
    public void Confirming_an_order_with_no_lines_fails()
    {
        var order = new Order(OrderId.New(), CustomerId.New());

        var act = () => order.Confirm();

        Assert.Throws<DomainException>(act);
    }

    [Fact]
    [Scenario("Confirming a draft order with at least one line transitions it to Confirmed")]
    public void Confirming_a_draft_order_with_lines_transitions_to_confirmed()
    {
        var order = new Order(OrderId.New(), CustomerId.New());
        order.AddLine(ProductId.New(), new Quantity(1), new Money(10, "USD"));

        order.Confirm();

        Assert.Equal(OrderStatus.Confirmed, order.Status);
        Assert.Contains(order.Events, e => e is OrderConfirmed);
    }
}
```
