package org.store.orders.domain;

import java.math.BigDecimal;

public record Money(BigDecimal amount, String currency) {
    public Money {
        if (amount == null) throw new IllegalArgumentException("Amount cannot be null");
        if (currency == null || currency.isBlank()) throw new IllegalArgumentException("Currency required");
    }
    public static Money of(BigDecimal amount, String currency) {
        return new Money(amount, currency);
    }
    public static Money zero(String currency) {
        return new Money(BigDecimal.ZERO, currency);
    }
    public Money add(Money other) {
        if (!currency.equals(other.currency)) throw new IllegalArgumentException("Currency mismatch");
        return new Money(amount.add(other.amount), currency);
    }
    public boolean isPositive() {
        return amount.compareTo(BigDecimal.ZERO) > 0;
    }
}
