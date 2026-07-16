package pl.shop.catalog.pricing;

import pl.shop.catalog.Money;

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

    public Money applyTo(Money price) {
        BigDecimal discountFraction = BigDecimal.valueOf(percentage)
                .divide(BigDecimal.valueOf(100), 4, RoundingMode.HALF_UP);
        BigDecimal discountAmount = price.amount().multiply(discountFraction);
        BigDecimal discountedAmount = price.amount().subtract(discountAmount);
        if (discountedAmount.compareTo(BigDecimal.ZERO) < 0) {
            return Money.zero(price.currency());
        }
        return Money.of(discountedAmount, price.currency());
    }

    public int percentage() {
        return percentage;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Discount discount = (Discount) o;
        return percentage == discount.percentage;
    }

    @Override
    public int hashCode() {
        return Objects.hash(percentage);
    }
}
