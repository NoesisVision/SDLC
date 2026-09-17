package com.acme.orders;

@Port(Direction.SECONDARY)
public interface OrderRepository extends Repository<Order, OrderId>, AutoCloseable {
    void save(Order order);
    Optional<Order> findById(OrderId id);
    default boolean exists(OrderId id) { return findById(id).isPresent(); }
    static OrderRepository inMemory() { return new InMemoryOrderRepository(); }
    private void helper() {}
}
