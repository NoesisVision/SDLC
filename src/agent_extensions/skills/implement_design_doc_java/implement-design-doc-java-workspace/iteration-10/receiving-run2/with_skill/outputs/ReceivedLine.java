package io.proj.warehouse.receiving;

import io.proj.warehouse.inventory.Quantity;
import io.proj.warehouse.inventory.Sku;

final class ReceivedLine {

    private final Sku sku;
    private final Quantity expectedQuantity;
    private final Quantity actualQuantity;

    ReceivedLine(Sku sku, Quantity expectedQuantity, Quantity actualQuantity) {
        this.sku = sku;
        this.expectedQuantity = expectedQuantity;
        this.actualQuantity = actualQuantity;
    }

    Quantity discrepancy() {
        return new Quantity(expectedQuantity.value() - actualQuantity.value());
    }

    Sku sku() { return sku; }
    Quantity expectedQuantity() { return expectedQuantity; }
    Quantity actualQuantity() { return actualQuantity; }
}
