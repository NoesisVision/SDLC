package io.proj.warehouse.receiving;

import io.proj.warehouse.inventory.Quantity;
import io.proj.warehouse.inventory.Sku;

public final class ReceivedLine {

    private final Sku sku;
    private final Quantity expectedQuantity;
    private final Quantity actualQuantity;

    ReceivedLine(Sku sku, Quantity expectedQuantity, Quantity actualQuantity) {
        this.sku = sku;
        this.expectedQuantity = expectedQuantity;
        this.actualQuantity = actualQuantity;
    }

    public Quantity discrepancy() {
        return new Quantity(expectedQuantity.value() - actualQuantity.value());
    }

    public Sku sku() { return sku; }
    public Quantity expectedQuantity() { return expectedQuantity; }
    public Quantity actualQuantity() { return actualQuantity; }
}
