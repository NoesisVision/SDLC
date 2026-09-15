package com.acme.sales.orders;

@Port(Direction.SECONDARY)
public interface OrderRepository {
    void save(Order order);
    Optional<Order> findById(OrderId id);
}
