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

    public static Discount of(int percentage) {
        return new Discount(percentage);
    }

    public static Discount none() {
        return new Discount(0);
    }

    public Money applyTo(Money price) {
        BigDecimal factor = BigDecimal.valueOf(100 - percentage)
                .divide(BigDecimal.valueOf(100));
        return price.multiply(factor);
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
