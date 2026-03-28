package net.ecom.fulfillment.returnprocessing;

import java.util.Objects;
import java.util.UUID;

public record ReturnReceiptId(UUID value) {
    public ReturnReceiptId { Objects.requireNonNull(value); }
    public static ReturnReceiptId generate() { return new ReturnReceiptId(UUID.randomUUID()); }
}
