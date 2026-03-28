package pl.shop.catalog.pricing;

import io.vavr.control.Either;
import pl.shop.catalog.ProductId;

import static io.vavr.control.Either.left;

public class ApplyDiscountService {

    private final PriceListRepository priceListRepository;

    public ApplyDiscountService(PriceListRepository priceListRepository) {
        this.priceListRepository = priceListRepository;
    }

    public Either<String, DiscountApplied> apply(ProductId productId, Discount discount) {
        return priceListRepository.findActive()
                .map(priceList -> applyAndSave(priceList, productId, discount))
                .orElse(left("No active price list found"));
    }

    private Either<String, DiscountApplied> applyAndSave(PriceList priceList, ProductId productId, Discount discount) {
        Either<String, DiscountApplied> result = priceList.applyDiscount(productId, discount);
        result.peek(event -> priceListRepository.save(priceList));
        return result;
    }
}
