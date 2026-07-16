package io.proj.warehouse.inventory;

import java.time.Instant;

public sealed interface InventoryEvents {

    record StockReceived(Sku sku, Quantity quantity, Instant occurredAt) implements InventoryEvents {}

    record StockAdjusted(Sku sku, Quantity oldQuantity, Quantity newQuantity, String reason, Instant occurredAt) implements InventoryEvents {}

    record StockDepleted(Sku sku, Instant occurredAt) implements InventoryEvents {}
}
