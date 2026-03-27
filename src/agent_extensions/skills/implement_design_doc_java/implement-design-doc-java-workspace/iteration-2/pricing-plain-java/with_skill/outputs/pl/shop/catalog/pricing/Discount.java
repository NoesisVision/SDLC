package pl.shop.catalog.pricing;

import pl.shop.catalog.Money;

import java.math.BigDecimal;
import java.util.Objects;

public final class Discount {

    private final int percentage;

    public Discount(int percentage) {
        if (percentage < 0 || percentage > 100) {
            throw new IllegalArgumentException("Discount percentage must be between 0 and 100");
        }
        this.percentage = percentage;
    }

    public Money applyTo(Money price) {
        BigDecimal factor = BigDecimal.valueOf(100 - percentage)
                .divide(BigDecimal.valueOf(100));
        BigDecimal discountedAmount = price.amount().multiply(factor);
        if (discountedAmount.compareTo(BigDecimal.ZERO) < 0) {
            discountedAmount = BigDecimal.ZERO;
        }
        return new Money(discountedAmount, price.currency());
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
