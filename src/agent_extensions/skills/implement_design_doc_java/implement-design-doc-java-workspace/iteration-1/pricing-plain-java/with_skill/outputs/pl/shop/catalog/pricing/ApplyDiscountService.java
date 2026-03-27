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
        PriceList priceList = priceListRepository.findActive()
                .orElse(null);
        if (priceList == null) {
            return left("No active price list found");
        }
        Either<String, DiscountApplied> result = priceList.applyDiscount(productId, discount);
        result.peek(event -> priceListRepository.save(priceList));
        return result;
    }
}
