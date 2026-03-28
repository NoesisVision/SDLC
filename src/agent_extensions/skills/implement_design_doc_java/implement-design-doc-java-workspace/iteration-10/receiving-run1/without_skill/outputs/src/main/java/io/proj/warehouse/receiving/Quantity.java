package io.proj.warehouse.receiving;

public record Quantity(int value) {
    public Quantity {
        if (value < 0) throw new IllegalArgumentException("Quantity cannot be negative");
    }

    public static Quantity zero() { return new Quantity(0); }

    public Quantity subtract(Quantity other) { return new Quantity(value - other.value); }
}
