package org.store.orders.application;

import java.time.Instant;

import org.store.orders.domain.OrderCancelled;
import org.store.orders.domain.OrderId;
import org.store.orders.domain.OrderRepository;

public class CancelOrderService {

    private final OrderRepository orderRepository;

    public CancelOrderService(OrderRepository orderRepository) {
        this.orderRepository = orderRepository;
    }

    public OrderCancelled cancel(OrderId orderId) {
        var order = orderRepository.findById(orderId)
                .orElseThrow(() -> new IllegalArgumentException("Order not found"));
        OrderCancelled event = order.cancel(Instant.now());
        orderRepository.save(order);
        return event;
    }
}
