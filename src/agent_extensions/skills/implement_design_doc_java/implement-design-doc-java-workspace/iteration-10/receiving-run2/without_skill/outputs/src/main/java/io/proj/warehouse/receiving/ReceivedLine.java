package io.proj.warehouse.receiving;

public final class ReceivedLine {

    private final Sku sku;
    private final Quantity expectedQuantity;
    private final Quantity actualQuantity;

    public ReceivedLine(Sku sku, Quantity expectedQuantity, Quantity actualQuantity) {
        this.sku = sku;
        this.expectedQuantity = expectedQuantity;
        this.actualQuantity = actualQuantity;
    }

    public Quantity discrepancy() {
        return new Quantity(Math.abs(expectedQuantity.value() - actualQuantity.value()));
    }

    public Sku sku() { return sku; }
    public Quantity expectedQuantity() { return expectedQuantity; }
    public Quantity actualQuantity() { return actualQuantity; }
}
