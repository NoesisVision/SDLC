package org.store.orders.application;

import org.store.orders.domain.OrderCancelled;
import org.store.orders.domain.OrderId;
import org.store.orders.domain.OrderRepository;

import java.time.Instant;

public class CancelOrderService {

    private final OrderRepository orderRepository;

    public CancelOrderService(OrderRepository orderRepository) {
        this.orderRepository = orderRepository;
    }

    public OrderCancelled cancel(OrderId orderId) {
        var order = orderRepository.findById(orderId)
                .orElseThrow(() -> new IllegalArgumentException("Order not found"));
        var event = order.cancel(Instant.now());
        orderRepository.save(order);
        return event;
    }
}
