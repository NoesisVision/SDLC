package pl.shop.inventory;

import io.vavr.control.Either;
import pl.shop.catalog.ProductId;

import static io.vavr.control.Either.left;

public class ReplenishStockService {

    private final InventoryRepository inventoryRepository;

    public ReplenishStockService(InventoryRepository inventoryRepository) {
        this.inventoryRepository = inventoryRepository;
    }

    public Either<String, StockReplenished> replenish(ProductId productId, int quantity) {
        InventoryItem item = inventoryRepository.findByProductId(productId)
                .orElse(InventoryItem.create(productId));
        Either<String, StockReplenished> result = item.replenish(quantity);
        result.peek(event -> inventoryRepository.save(item));
        return result;
    }
}
