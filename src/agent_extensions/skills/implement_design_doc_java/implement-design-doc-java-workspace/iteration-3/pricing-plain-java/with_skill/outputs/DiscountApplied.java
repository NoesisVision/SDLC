package pl.shop.catalog.pricing;

import pl.shop.catalog.ProductId;

import java.util.Objects;

public class DiscountApplied {

    private final PriceListId priceListId;
    private final ProductId productId;
    private final Discount discount;

    DiscountApplied(PriceListId priceListId, ProductId productId, Discount discount) {
        this.priceListId = priceListId;
        this.productId = productId;
        this.discount = discount;
    }

    public PriceListId priceListId() {
        return priceListId;
    }

    public ProductId productId() {
        return productId;
    }

    public Discount discount() {
        return discount;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        DiscountApplied that = (DiscountApplied) o;
        return Objects.equals(priceListId, that.priceListId)
                && Objects.equals(productId, that.productId)
                && Objects.equals(discount, that.discount);
    }

    @Override
    public int hashCode() {
        return Objects.hash(priceListId, productId, discount);
    }
}
