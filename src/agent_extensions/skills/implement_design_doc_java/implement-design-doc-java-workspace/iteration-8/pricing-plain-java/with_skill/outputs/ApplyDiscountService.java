package pl.shop.catalog.pricing;

import io.vavr.control.Either;
import pl.shop.catalog.ProductId;

import static io.vavr.control.Either.left;

public class ApplyDiscountService {

    private final PriceListRepository priceListRepository;

    public ApplyDiscountService(PriceListRepository priceListRepository) {
        this.priceListRepository = priceListRepository;
    }

    public Either<String, DiscountApplied> apply(PriceListId priceListId, ProductId productId, Discount discount) {
        PriceList priceList = priceListRepository.findById(priceListId)
                .orElse(null);
        if (priceList == null) {
            return left("Price list not found: " + priceListId);
        }
        if (!priceList.isActive()) {
            return left("Price list is not active");
        }
        Either<String, DiscountApplied> result = priceList.applyDiscount(productId, discount);
        result.peek(event -> priceListRepository.save(priceList));
        return result;
    }
}
