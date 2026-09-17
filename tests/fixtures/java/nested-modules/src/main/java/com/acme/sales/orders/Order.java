package com.acme.sales.orders;

@AggregateRoot
public class Order {
    public Order(OrderId id) {}
    public void place() {}
    public void cancel() {}
}
