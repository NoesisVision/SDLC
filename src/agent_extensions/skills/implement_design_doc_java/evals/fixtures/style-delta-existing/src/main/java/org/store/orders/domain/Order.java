package org.store.orders.domain;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class Order {

    enum Status { DRAFT, PLACED }

    private final OrderId id;
    private final CustomerId customerId;
    private final List<OrderLine> lines;
    private Status status;
    private final Instant createdAt;

    private Order(OrderId id, CustomerId customerId, Instant createdAt) {
        this.id = id;
        this.customerId = customerId;
        this.lines = new ArrayList<>();
        this.status = Status.DRAFT;
        this.createdAt = createdAt;
    }

    public static Order create(CustomerId customerId, Instant now) {
        return new Order(OrderId.generate(), customerId, now);
    }

    public void addLine(String productName, int quantity, Money unitPrice) {
        if (status != Status.DRAFT) {
            throw new IllegalStateException("Can only add lines to draft orders");
        }
        lines.add(new OrderLine(productName, quantity, unitPrice));
    }

    public void place() {
        if (lines.isEmpty()) {
            throw new IllegalStateException("Cannot place an empty order");
        }
        this.status = Status.PLACED;
    }

    public Money total() {
        return lines.stream()
                .map(OrderLine::lineTotal)
                .reduce(Money.zero("USD"), Money::add);
    }

    public OrderId id() { return id; }
    public CustomerId customerId() { return customerId; }
    public List<OrderLine> lines() { return Collections.unmodifiableList(lines); }
    public boolean isDraft() { return status == Status.DRAFT; }
    public boolean isPlaced() { return status == Status.PLACED; }
}
