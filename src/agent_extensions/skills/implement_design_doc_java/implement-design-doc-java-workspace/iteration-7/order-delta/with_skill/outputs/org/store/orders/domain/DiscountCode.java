package org.store.orders.domain;

public record DiscountCode(String code, int percentage) {
    public DiscountCode {
        if (code == null || code.isBlank()) throw new IllegalArgumentException("Code required");
        if (percentage < 0 || percentage > 100) throw new IllegalArgumentException("Discount percentage must be between 0 and 100");
    }

    public Money applyTo(Money money) {
        var discountedAmount = money.amount().multiply(
                java.math.BigDecimal.valueOf(100 - percentage)).divide(
                java.math.BigDecimal.valueOf(100), money.amount().scale(), java.math.RoundingMode.HALF_UP);
        return Money.of(discountedAmount, money.currency());
    }
}
