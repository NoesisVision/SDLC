package pl.shop.catalog.pricing;

import io.vavr.control.Either;
import pl.shop.catalog.Money;
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
        return new PriceList(PriceListId.newOne(), name);
    }

    public Either<String, PriceListActivated> activate() {
        if (entries.isEmpty()) {
            return left("A price list must have at least one price entry");
        }
        this.active = true;
        return right(new PriceListActivated(id));
    }

    public void addEntry(ProductId productId, Money basePrice) {
        if (basePrice.amount().signum() <= 0) {
            throw new IllegalArgumentException("Base price must be positive");
        }
        entries.add(new PriceEntry(productId, basePrice));
    }

    public Either<String, DiscountApplied> applyDiscount(ProductId productId, Discount discount) {
        Optional<PriceEntry> entry = findEntry(productId);
        if (entry.isEmpty()) {
            return left("No price entry found for product: " + productId);
        }
        entry.get().applyDiscount(discount);
        return right(new DiscountApplied(id, productId, discount));
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

    private Optional<PriceEntry> findEntry(ProductId productId) {
        return entries.stream()
                .filter(e -> e.productId().equals(productId))
                .findFirst();
    }
}
