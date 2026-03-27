package com.example.orders.application;

import com.example.orders.domain.DomainEventPublisher;
import com.example.orders.domain.Order;
import com.example.orders.domain.OrderId;
import com.example.orders.domain.OrderRepository;

class SubmitOrderService {

    private final OrderRepository orderRepository;
    private final DomainEventPublisher eventPublisher;

    SubmitOrderService(OrderRepository orderRepository, DomainEventPublisher eventPublisher) {
        this.orderRepository = orderRepository;
        this.eventPublisher = eventPublisher;
    }

    void submit(OrderId orderId) {
        Order order = orderRepository.findById(orderId)
                .orElseThrow(() -> new IllegalArgumentException("Order not found: " + orderId));
        order.submit();
        orderRepository.save(order);
        order.flushEvents().forEach(eventPublisher::publish);
    }
}
