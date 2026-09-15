package com.acme.sales.orders.pricing;

@ValueObject
public record Money(BigDecimal amount) {
    public Money add(Money other) { return null; }
}
