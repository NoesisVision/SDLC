package io.proj.warehouse.receiving;

public record Quantity(int value) {
    public Quantity {
        if (value < 0) throw new IllegalArgumentException("Quantity cannot be negative");
    }

    public Quantity subtract(Quantity other) {
        return new Quantity(this.value - other.value);
    }
}
