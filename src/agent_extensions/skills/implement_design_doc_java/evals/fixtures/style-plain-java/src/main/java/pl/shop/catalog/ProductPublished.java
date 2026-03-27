package pl.shop.catalog;

import java.util.Objects;

public class ProductPublished {

    private final ProductId productId;

    ProductPublished(ProductId productId) {
        this.productId = productId;
    }

    public ProductId productId() {
        return productId;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        ProductPublished that = (ProductPublished) o;
        return Objects.equals(productId, that.productId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(productId);
    }
}
