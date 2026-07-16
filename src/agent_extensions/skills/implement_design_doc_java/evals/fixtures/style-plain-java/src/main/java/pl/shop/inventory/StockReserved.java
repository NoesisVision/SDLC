package pl.shop.inventory;

import pl.shop.catalog.ProductId;

import java.util.Objects;

public class StockReserved {

    private final ProductId productId;
    private final int quantity;

    StockReserved(ProductId productId, int quantity) {
        this.productId = productId;
        this.quantity = quantity;
    }

    public ProductId productId() {
        return productId;
    }

    public int quantity() {
        return quantity;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        StockReserved that = (StockReserved) o;
        return quantity == that.quantity && Objects.equals(productId, that.productId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(productId, quantity);
    }
}
