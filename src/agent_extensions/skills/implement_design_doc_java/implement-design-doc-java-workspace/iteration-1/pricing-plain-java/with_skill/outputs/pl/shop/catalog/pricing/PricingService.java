package pl.shop.catalog.pricing;

import pl.shop.catalog.ProductId;

import java.util.Optional;

public class PricingService {

    private final PriceListRepository priceListRepository;

    public PricingService(PriceListRepository priceListRepository) {
        this.priceListRepository = priceListRepository;
    }

    public Optional<Money> calculatePrice(ProductId productId) {
        return priceListRepository.findActive()
                .flatMap(priceList -> priceList.entries().stream()
                        .filter(entry -> entry.productId().equals(productId))
                        .findFirst()
                        .map(PriceEntry::effectivePrice));
    }
}
