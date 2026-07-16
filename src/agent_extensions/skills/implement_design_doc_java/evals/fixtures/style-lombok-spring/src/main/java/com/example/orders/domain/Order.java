package com.example.orders.domain;

import lombok.Getter;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@Getter
public class Order {

    private final OrderId id;
    private final List<OrderLine> lines;
    private OrderStatus status;
    private final Instant createdAt;
    private final List<DomainEvent> pendingEvents = new ArrayList<>();

    private Order(OrderId id, Instant createdAt) {
        this.id = id;
        this.lines = new ArrayList<>();
        this.status = OrderStatus.DRAFT;
        this.createdAt = createdAt;
    }

    public static Order create(OrderId id, Instant createdAt) {
        Order order = new Order(id, createdAt);
        order.pendingEvents.add(new OrderCreated(id, createdAt));
        return order;
    }

    public void addLine(ProductId productId, int quantity, Money unitPrice) {
        if (status != OrderStatus.DRAFT) {
            throw new IllegalStateException("Can only add lines to draft orders");
        }
        lines.add(new OrderLine(productId, quantity, unitPrice));
    }

    public void submit() {
        if (lines.isEmpty()) {
            throw new IllegalStateException("Cannot submit empty order");
        }
        this.status = OrderStatus.SUBMITTED;
        pendingEvents.add(new OrderSubmitted(id, total(), Instant.now()));
    }

    public Money total() {
        return lines.stream()
                .map(OrderLine::lineTotal)
                .reduce(Money.zero("USD"), Money::add);
    }

    public List<DomainEvent> flushEvents() {
        List<DomainEvent> events = List.copyOf(pendingEvents);
        pendingEvents.clear();
        return events;
    }
}
