package io.proj.warehouse.inventory;

public final class ReceiveStockHandler {

    private final InventoryItem.Repository repository;

    public ReceiveStockHandler(InventoryItem.Repository repository) {
        this.repository = repository;
    }

    public void handle(Sku sku, Quantity quantity) {
        var item = repository.findBySku(sku);
        item.receive(quantity);
        repository.save(item);
    }
}
