package pl.shop.inventory;

import pl.shop.catalog.ProductId;

import java.util.Optional;

public interface InventoryRepository {
    void save(InventoryItem item);
    Optional<InventoryItem> findByProductId(ProductId productId);
}
