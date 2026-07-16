package org.store.orders.domain;

import java.math.BigDecimal;

public record DiscountCode(String code, int percentage) {

    public DiscountCode {
        if (code == null || code.isBlank()) throw new IllegalArgumentException("Code is required");
        if (percentage < 0 || percentage > 100) throw new IllegalArgumentException("Discount percentage must be between 0 and 100");
    }

    public Money applyTo(Money amount) {
        BigDecimal factor = BigDecimal.ONE.subtract(BigDecimal.valueOf(percentage).divide(BigDecimal.valueOf(100)));
        return Money.of(amount.amount().multiply(factor), amount.currency());
    }
}
