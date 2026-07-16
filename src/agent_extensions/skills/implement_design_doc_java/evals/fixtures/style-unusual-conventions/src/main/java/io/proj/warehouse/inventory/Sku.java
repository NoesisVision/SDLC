package io.proj.warehouse.inventory;

import java.util.Objects;

public record Sku(String value) {
    public Sku {
        Objects.requireNonNull(value);
        if (value.isBlank()) throw new IllegalArgumentException("SKU cannot be blank");
    }
}
