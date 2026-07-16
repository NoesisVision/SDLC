package pl.shop.catalog.pricing;

import pl.shop.catalog.Money;
import pl.shop.catalog.ProductId;

import java.util.Objects;

class PriceEntry {

    private final ProductId productId;
    private final Money basePrice;
    private Discount discount;

    PriceEntry(ProductId productId, Money basePrice, Discount discount) {
        this.productId = productId;
        this.basePrice = basePrice;
        this.discount = discount;
    }

    Money effectivePrice() {
        return discount.applyTo(basePrice);
    }

    void applyDiscount(Discount discount) {
        this.discount = discount;
    }

    ProductId productId() {
        return productId;
    }

    Money basePrice() {
        return basePrice;
    }

    Discount discount() {
        return discount;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        PriceEntry that = (PriceEntry) o;
        return Objects.equals(productId, that.productId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(productId);
    }
}
