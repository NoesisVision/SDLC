package pl.shop.inventory;

import pl.shop.catalog.ProductId;

import java.util.Objects;

public class StockReplenished {

    private final ProductId productId;
    private final StockLevel newLevel;

    StockReplenished(ProductId productId, StockLevel newLevel) {
        this.productId = productId;
        this.newLevel = newLevel;
    }

    public ProductId productId() {
        return productId;
    }

    public StockLevel newLevel() {
        return newLevel;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        StockReplenished that = (StockReplenished) o;
        return Objects.equals(productId, that.productId) && Objects.equals(newLevel, that.newLevel);
    }

    @Override
    public int hashCode() {
        return Objects.hash(productId, newLevel);
    }
}
