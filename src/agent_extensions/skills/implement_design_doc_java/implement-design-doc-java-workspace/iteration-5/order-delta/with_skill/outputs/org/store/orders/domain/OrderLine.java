package org.store.orders.domain;

record OrderLine(String productName, int quantity, Money unitPrice) {

    OrderLine {
        if (quantity <= 0) throw new IllegalArgumentException("Quantity must be positive");
    }

    Money lineTotal() {
        return Money.of(unitPrice.amount().multiply(java.math.BigDecimal.valueOf(quantity)), unitPrice.currency());
    }
}
