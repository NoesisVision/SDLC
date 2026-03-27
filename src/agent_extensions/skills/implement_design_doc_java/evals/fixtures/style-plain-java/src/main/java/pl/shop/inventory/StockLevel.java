package pl.shop.inventory;

import java.util.Objects;

public final class StockLevel {

    private final int quantity;

    public StockLevel(int quantity) {
        if (quantity < 0) {
            throw new IllegalArgumentException("Stock level cannot be negative");
        }
        this.quantity = quantity;
    }

    public static StockLevel of(int quantity) {
        return new StockLevel(quantity);
    }

    public static StockLevel zero() {
        return new StockLevel(0);
    }

    public StockLevel increase(int amount) {
        return new StockLevel(quantity + amount);
    }

    public StockLevel decrease(int amount) {
        if (quantity - amount < 0) {
            throw new IllegalArgumentException("Cannot decrease below zero");
        }
        return new StockLevel(quantity - amount);
    }

    public boolean isAvailable() {
        return quantity > 0;
    }

    public int quantity() {
        return quantity;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        StockLevel that = (StockLevel) o;
        return quantity == that.quantity;
    }

    @Override
    public int hashCode() {
        return Objects.hash(quantity);
    }
}
