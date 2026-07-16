package io.proj.warehouse.inventory;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

public final class InventoryItem {

    private final Sku sku;
    private Quantity onHand;
    private final List<InventoryEvents> pendingEvents = new ArrayList<>();

    private InventoryItem(Sku sku, Quantity onHand) {
        this.sku = sku;
        this.onHand = onHand;
    }

    public static InventoryItem register(Sku sku) {
        return new InventoryItem(sku, Quantity.zero());
    }

    public void receive(Quantity quantity) {
        this.onHand = onHand.add(quantity);
        pendingEvents.add(new InventoryEvents.StockReceived(sku, quantity, Instant.now()));
    }

    public void adjust(Quantity newQuantity, String reason) {
        var old = this.onHand;
        this.onHand = newQuantity;
        pendingEvents.add(new InventoryEvents.StockAdjusted(sku, old, newQuantity, reason, Instant.now()));
        if (newQuantity.isZero()) {
            pendingEvents.add(new InventoryEvents.StockDepleted(sku, Instant.now()));
        }
    }

    public Sku sku() { return sku; }
    public Quantity onHand() { return onHand; }

    public List<InventoryEvents> flushEvents() {
        var events = List.copyOf(pendingEvents);
        pendingEvents.clear();
        return events;
    }

    public interface Repository {
        void save(InventoryItem item);
        InventoryItem findBySku(Sku sku);
    }

    public static class Factory {
        private final Repository repository;

        public Factory(Repository repository) {
            this.repository = repository;
        }

        public InventoryItem registerNew(Sku sku) {
            var item = InventoryItem.register(sku);
            repository.save(item);
            return item;
        }
    }
}
