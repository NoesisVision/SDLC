package pl.shop.catalog;

import java.util.Objects;

public final class ProductName {

    private final String value;

    public ProductName(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Product name cannot be empty");
        }
        if (value.length() > 200) {
            throw new IllegalArgumentException("Product name cannot exceed 200 characters");
        }
        this.value = value;
    }

    public String value() {
        return value;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        ProductName that = (ProductName) o;
        return Objects.equals(value, that.value);
    }

    @Override
    public int hashCode() {
        return Objects.hash(value);
    }
}
