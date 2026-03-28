package pl.shop.catalog.pricing;

import java.util.Objects;

public class PriceListActivated {

    private final PriceListId priceListId;

    PriceListActivated(PriceListId priceListId) {
        this.priceListId = priceListId;
    }

    public PriceListId priceListId() {
        return priceListId;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        PriceListActivated that = (PriceListActivated) o;
        return Objects.equals(priceListId, that.priceListId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(priceListId);
    }
}
