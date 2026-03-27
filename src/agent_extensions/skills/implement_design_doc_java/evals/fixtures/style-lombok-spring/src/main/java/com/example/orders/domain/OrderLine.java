package com.example.orders.domain;

import lombok.Value;

@Value
public class OrderLine {
    ProductId productId;
    int quantity;
    Money unitPrice;

    public Money lineTotal() {
        return Money.of(unitPrice.getAmount().multiply(java.math.BigDecimal.valueOf(quantity)), unitPrice.getCurrency());
    }
}
