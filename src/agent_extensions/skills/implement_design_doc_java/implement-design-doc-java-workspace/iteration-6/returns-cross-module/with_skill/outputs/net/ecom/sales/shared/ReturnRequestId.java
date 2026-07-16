package net.ecom.sales.shared;

import java.util.Objects;
import java.util.UUID;

public record ReturnRequestId(UUID value) {
    public ReturnRequestId { Objects.requireNonNull(value); }
    public static ReturnRequestId generate() { return new ReturnRequestId(UUID.randomUUID()); }
}
