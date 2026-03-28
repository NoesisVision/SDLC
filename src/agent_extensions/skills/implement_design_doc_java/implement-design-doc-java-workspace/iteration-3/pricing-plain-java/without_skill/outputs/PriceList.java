package pl.shop.catalog.pricing;

import io.vavr.control.Either;
import pl.shop.catalog.ProductId;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

import static io.vavr.control.Either.left;
import static io.vavr.control.Either.right;

public class PriceList {

    private final PriceListId id;
    private final String name;
    private final List<PriceEntry> entries;
    private boolean active;

    PriceList(PriceListId id, String name) {
        this.id = id;
        this.name = name;
        this.entries = new ArrayList<>();
        this.active = false;
    }

    public static PriceList create(String name) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("Price list name cannot be empty");
        }
        return new PriceList(PriceListId.newOne(), name);
    }

    public Either<String, Void> addEntry(PriceEntry entry, Money basePrice) {
        if (basePrice.amount().compareTo(java.math.BigDecimal.ZERO) <= 0) {
            return left("Base price must be positive");
        }
        if (findEntry(entry.productId()).isPresent()) {
            return left("Entry for product already exists");
        }
        entries.add(entry);
        return right(null);
    }

    public Either<String, DiscountApplied> applyDiscount(ProductId productId, Discount discount) {
        return findEntry(productId)
                .map(entry -> applyDiscountToEntry(entry, discount))
                .orElse(left("Price entry not found for product: " + productId));
    }

    public Either<String, PriceListActivated> activate() {
        if (entries.isEmpty()) {
            return left("A price list must have at least one price entry");
        }
        this.active = true;
        return right(new PriceListActivated(id));
    }

    public PriceListId id() {
        return id;
    }

    public String name() {
        return name;
    }

    public List<PriceEntry> entries() {
        return Collections.unmodifiableList(entries);
    }

    public boolean isActive() {
        return active;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        PriceList priceList = (PriceList) o;
        return Objects.equals(id, priceList.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }

    private Either<String, DiscountApplied> applyDiscountToEntry(PriceEntry entry, Discount discount) {
        entry.applyDiscount(discount);
        return right(new DiscountApplied(id, entry.productId(), discount));
    }

    private Optional<PriceEntry> findEntry(ProductId productId) {
        return entries.stream()
                .filter(e -> e.productId().equals(productId))
                .findFirst();
    }
}
