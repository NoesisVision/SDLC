package org.store.orders.domain;

import java.time.Instant;

public record OrderCancelled(OrderId orderId, Instant cancelledAt) {

    public OrderCancelled {
        if (orderId == null) throw new IllegalArgumentException("Order id is required");
        if (cancelledAt == null) throw new IllegalArgumentException("Cancelled at is required");
    }
}
