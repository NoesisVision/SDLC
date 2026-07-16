package pl.shop.catalog.pricing;

import pl.shop.catalog.Money;
import pl.shop.catalog.ProductId;

import java.util.Optional;

public class PricingService {

    public Optional<Money> calculatePrice(PriceList priceList, ProductId productId) {
        if (!priceList.isActive()) {
            return Optional.empty();
        }
        return priceList.entries().stream()
                .filter(entry -> entry.productId().equals(productId))
                .findFirst()
                .map(PriceEntry::effectivePrice);
    }
}
