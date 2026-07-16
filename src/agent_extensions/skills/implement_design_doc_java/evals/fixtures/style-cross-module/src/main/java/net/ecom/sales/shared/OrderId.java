package net.ecom.sales.shared;

import java.util.Objects;
import java.util.UUID;

public record OrderId(UUID value) {
    public OrderId { Objects.requireNonNull(value); }
    public static OrderId generate() { return new OrderId(UUID.randomUUID()); }
}
