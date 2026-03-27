package com.example.orders.application;

import com.example.orders.domain.DomainEventPublisher;
import com.example.orders.domain.Order;
import com.example.orders.domain.OrderId;
import com.example.orders.domain.OrderRepository;

import java.time.Clock;
import java.time.Instant;

class CreateOrderService {

    private final OrderRepository orderRepository;
    private final DomainEventPublisher eventPublisher;
    private final Clock clock;

    CreateOrderService(OrderRepository orderRepository, DomainEventPublisher eventPublisher, Clock clock) {
        this.orderRepository = orderRepository;
        this.eventPublisher = eventPublisher;
        this.clock = clock;
    }

    OrderId create() {
        OrderId orderId = OrderId.generate();
        Order order = Order.create(orderId, Instant.now(clock));
        orderRepository.save(order);
        order.flushEvents().forEach(eventPublisher::publish);
        return orderId;
    }
}
