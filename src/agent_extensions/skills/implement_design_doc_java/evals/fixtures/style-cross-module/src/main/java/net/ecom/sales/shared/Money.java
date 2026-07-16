package net.ecom.sales.shared;

import java.math.BigDecimal;

public record Money(BigDecimal amount, String currency) {
    public static Money of(BigDecimal amount, String currency) { return new Money(amount, currency); }
    public static Money zero(String currency) { return new Money(BigDecimal.ZERO, currency); }
    public Money add(Money other) { return new Money(amount.add(other.amount), currency); }
}
