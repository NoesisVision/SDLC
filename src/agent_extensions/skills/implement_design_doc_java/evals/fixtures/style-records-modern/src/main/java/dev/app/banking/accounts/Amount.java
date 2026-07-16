package dev.app.banking.accounts;

import java.math.BigDecimal;

public record Amount(BigDecimal value) {

    public Amount {
        if (value == null) throw new IllegalArgumentException("Amount cannot be null");
    }

    public static Amount of(BigDecimal value) {
        return new Amount(value);
    }

    public static Amount zero() {
        return new Amount(BigDecimal.ZERO);
    }

    public Amount add(Amount other) {
        return new Amount(value.add(other.value));
    }

    public Amount subtract(Amount other) {
        return new Amount(value.subtract(other.value));
    }

    public boolean isNegative() {
        return value.compareTo(BigDecimal.ZERO) < 0;
    }
}
