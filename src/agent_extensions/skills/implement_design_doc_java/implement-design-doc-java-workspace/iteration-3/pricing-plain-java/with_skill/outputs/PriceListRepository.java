package pl.shop.catalog.pricing;

import java.util.Optional;

public interface PriceListRepository {
    void save(PriceList priceList);
    Optional<PriceList> findById(PriceListId id);
}
