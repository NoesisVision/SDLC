package pl.shop.catalog.pricing;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Objects;

public final class Discount {

    private final int percentage;

    public Discount(int percentage) {
        if (percentage < 0 || percentage > 100) {
            throw new IllegalArgumentException("Discount percentage must be between 0 and 100");
        }
        this.percentage = percentage;
    }

    public Money applyTo(Money amount) {
        BigDecimal discount = amount.amount()
                .multiply(BigDecimal.valueOf(percentage))
                .divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP);
        BigDecimal result = amount.amount().subtract(discount);
        if (result.compareTo(BigDecimal.ZERO) < 0) {
            return new Money(BigDecimal.ZERO, amount.currency());
        }
        return new Money(result, amount.currency());
    }

    public int percentage() {
        return percentage;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Discount that = (Discount) o;
        return percentage == that.percentage;
    }

    @Override
    public int hashCode() {
        return Objects.hash(percentage);
    }
}
