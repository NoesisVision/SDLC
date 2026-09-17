package com.acme.orders;

@ValueObject
public record Money(BigDecimal amount, Currency currency) implements Comparable<Money> {
    public Money {
        Objects.requireNonNull(amount);
    }
    public Money add(Money other) { return new Money(amount.add(other.amount), currency); }
    public static Money zero(Currency currency) { return new Money(BigDecimal.ZERO, currency); }
    @Override public int compareTo(Money other) { return amount.compareTo(other.amount); }
}
