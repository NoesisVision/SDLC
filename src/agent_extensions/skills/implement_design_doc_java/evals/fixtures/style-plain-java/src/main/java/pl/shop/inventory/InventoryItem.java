package pl.shop.inventory;

import io.vavr.control.Either;
import pl.shop.catalog.ProductId;

import java.util.Objects;

import static io.vavr.control.Either.left;
import static io.vavr.control.Either.right;

public class InventoryItem {

    private final ProductId productId;
    private StockLevel stockLevel;

    InventoryItem(ProductId productId, StockLevel stockLevel) {
        this.productId = productId;
        this.stockLevel = stockLevel;
    }

    public static InventoryItem create(ProductId productId) {
        return new InventoryItem(productId, StockLevel.zero());
    }

    public Either<String, StockReplenished> replenish(int quantity) {
        if (quantity <= 0) {
            return left("Replenish quantity must be positive");
        }
        this.stockLevel = stockLevel.increase(quantity);
        return right(new StockReplenished(productId, stockLevel));
    }

    public Either<String, StockReserved> reserve(int quantity) {
        if (!stockLevel.isAvailable()) {
            return left("No stock available");
        }
        try {
            this.stockLevel = stockLevel.decrease(quantity);
            return right(new StockReserved(productId, quantity));
        } catch (IllegalArgumentException e) {
            return left("Insufficient stock");
        }
    }

    public ProductId productId() {
        return productId;
    }

    public StockLevel stockLevel() {
        return stockLevel;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        InventoryItem that = (InventoryItem) o;
        return Objects.equals(productId, that.productId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(productId);
    }
}
