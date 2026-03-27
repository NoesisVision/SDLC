package pl.shop.catalog;

import java.util.Objects;
import java.util.UUID;

public final class ProductId {

    private final UUID value;

    public ProductId(UUID value) {
        Objects.requireNonNull(value, "ProductId cannot be null");
        this.value = value;
    }

    public static ProductId newOne() {
        return new ProductId(UUID.randomUUID());
    }

    public UUID value() {
        return value;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        ProductId that = (ProductId) o;
        return Objects.equals(value, that.value);
    }

    @Override
    public int hashCode() {
        return Objects.hash(value);
    }
}
