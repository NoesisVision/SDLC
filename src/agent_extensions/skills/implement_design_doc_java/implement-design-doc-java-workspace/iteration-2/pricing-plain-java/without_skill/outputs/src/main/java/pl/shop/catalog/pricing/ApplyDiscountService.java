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
        return priceListRepository.findById(priceListId)
                .map(priceList -> applyDiscountToPriceList(priceList, productId, discount))
                .orElse(left("Price list not found: " + priceListId));
    }

    private Either<String, DiscountApplied> applyDiscountToPriceList(PriceList priceList, ProductId productId, Discount discount) {
        Either<String, DiscountApplied> result = priceList.applyDiscount(productId, discount);
        result.peek(event -> priceListRepository.save(priceList));
        return result;
    }
}
