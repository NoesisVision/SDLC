package org.store.orders.domain;

import java.time.Instant;

public record OrderCancelled(OrderId orderId, Instant cancelledAt) {
}
