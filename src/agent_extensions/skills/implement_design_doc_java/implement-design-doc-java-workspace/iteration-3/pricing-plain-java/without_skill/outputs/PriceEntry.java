package pl.shop.catalog.pricing;

import pl.shop.catalog.ProductId;

import java.util.Objects;

public class PriceEntry {

    private final ProductId productId;
    private final Money basePrice;
    private Discount discount;

    PriceEntry(ProductId productId, Money basePrice) {
        Objects.requireNonNull(productId, "ProductId cannot be null");
        Objects.requireNonNull(basePrice, "Base price cannot be null");
        this.productId = productId;
        this.basePrice = basePrice;
        this.discount = Discount.none();
    }

    public Money effectivePrice() {
        return discount.applyTo(basePrice);
    }

    public void applyDiscount(Discount discount) {
        Objects.requireNonNull(discount, "Discount cannot be null");
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
