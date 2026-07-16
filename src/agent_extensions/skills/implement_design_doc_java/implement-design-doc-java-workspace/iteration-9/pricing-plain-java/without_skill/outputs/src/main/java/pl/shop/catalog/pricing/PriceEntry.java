package pl.shop.catalog.pricing;

import pl.shop.catalog.Money;
import pl.shop.catalog.ProductId;

import java.util.Objects;

public class PriceEntry {

    private final ProductId productId;
    private final Money basePrice;
    private Discount discount;

    PriceEntry(ProductId productId, Money basePrice) {
        this.productId = productId;
        this.basePrice = basePrice;
        this.discount = null;
    }

    public Money effectivePrice() {
        if (discount == null) {
            return basePrice;
        }
        return discount.applyTo(basePrice);
    }

    public void applyDiscount(Discount discount) {
        this.discount = discount;
    }

    public ProductId productId() {
        return productId;
    }

    public Money basePrice() {
        return basePrice;
    }

    public Discount discount() {
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
