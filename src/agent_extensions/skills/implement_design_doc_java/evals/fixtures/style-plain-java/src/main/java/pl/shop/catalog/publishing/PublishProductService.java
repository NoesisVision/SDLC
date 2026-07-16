package pl.shop.catalog.publishing;

import io.vavr.control.Either;
import pl.shop.catalog.Product;
import pl.shop.catalog.ProductId;
import pl.shop.catalog.ProductPublished;
import pl.shop.catalog.ProductRepository;

import static io.vavr.control.Either.left;

public class PublishProductService {

    private final ProductRepository productRepository;

    public PublishProductService(ProductRepository productRepository) {
        this.productRepository = productRepository;
    }

    public Either<String, ProductPublished> publish(ProductId productId) {
        return productRepository.findById(productId)
                .map(Product::publish)
                .orElse(left("Product not found: " + productId));
    }
}
