package org.store.orders.domain;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class Order {

    private final OrderId id;
    private final CustomerId customerId;
    private final List<OrderLine> lines;
    private OrderStatus status;
    private final Instant createdAt;
    private ShippingAddress shippingAddress;
    private DiscountCode discountCode;

    private Order(OrderId id, CustomerId customerId, Instant createdAt) {
        this.id = id;
        this.customerId = customerId;
        this.lines = new ArrayList<>();
        this.status = OrderStatus.DRAFT;
        this.createdAt = createdAt;
    }

    public static Order create(CustomerId customerId, Instant now) {
        return new Order(OrderId.generate(), customerId, now);
    }

    public void addLine(String productName, int quantity, Money unitPrice) {
        if (status != OrderStatus.DRAFT) {
            throw new IllegalStateException("Can only add lines to draft orders");
        }
        lines.add(new OrderLine(productName, quantity, unitPrice));
    }

    public void applyDiscount(DiscountCode discountCode) {
        this.discountCode = discountCode;
    }

    public OrderCancelled cancel(Instant now) {
        if (status != OrderStatus.PLACED) {
            throw new IllegalStateException("Only placed orders can be cancelled");
        }
        this.status = OrderStatus.CANCELLED;
        return new OrderCancelled(id, now);
    }

    public Money discountedTotal() {
        Money orderTotal = total();
        if (discountCode == null) {
            return orderTotal;
        }
        return discountCode.applyTo(orderTotal);
    }

    public void place() {
        if (lines.isEmpty()) {
            throw new IllegalStateException("Cannot place an empty order");
        }
        this.status = OrderStatus.PLACED;
    }

    public void setShippingAddress(ShippingAddress shippingAddress) {
        if (status != OrderStatus.DRAFT) {
            throw new IllegalStateException("Shipping address can only be set on draft orders");
        }
        this.shippingAddress = shippingAddress;
    }

    public Money total() {
        return lines.stream()
                .map(OrderLine::lineTotal)
                .reduce(Money.zero("USD"), Money::add);
    }

    public OrderId id() { return id; }
    public CustomerId customerId() { return customerId; }
    public List<OrderLine> lines() { return Collections.unmodifiableList(lines); }
    public OrderStatus status() { return status; }
    public ShippingAddress shippingAddress() { return shippingAddress; }
    public DiscountCode discountCode() { return discountCode; }
    public boolean isDraft() { return status == OrderStatus.DRAFT; }
    public boolean isPlaced() { return status == OrderStatus.PLACED; }
    public boolean isCancelled() { return status == OrderStatus.CANCELLED; }
}
