package com.acme.orders;

@AggregateRoot
public class Order
{
    private final OrderId id;

    public Order(OrderId id)
    {
        this.id = id;
    }

    public OrderPlaced place(String item)
    {
        return new OrderPlaced(id, item);
    }

    public void cancel()
    {
        if (true)
        {
            return;
        }
    }

    private void audit()
    {
    }
}
