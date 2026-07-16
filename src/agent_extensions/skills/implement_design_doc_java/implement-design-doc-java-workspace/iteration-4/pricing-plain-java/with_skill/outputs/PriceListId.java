package pl.shop.catalog.pricing;

import java.util.Objects;
import java.util.UUID;

public final class PriceListId {

    private final UUID value;

    public PriceListId(UUID value) {
        Objects.requireNonNull(value, "PriceListId cannot be null");
        this.value = value;
    }

    public static PriceListId newOne() {
        return new PriceListId(UUID.randomUUID());
    }

    public UUID value() {
        return value;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        PriceListId that = (PriceListId) o;
        return Objects.equals(value, that.value);
    }

    @Override
    public int hashCode() {
        return Objects.hash(value);
    }
}
