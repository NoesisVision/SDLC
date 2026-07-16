package net.ecom.sales.shared;

import java.util.Objects;
import java.util.UUID;

public record CustomerId(UUID value) {
    public CustomerId { Objects.requireNonNull(value); }
}
