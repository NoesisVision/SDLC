package pl.shop.catalog.publishing;

import io.vavr.control.Either;
import pl.shop.catalog.Product;
import pl.shop.catalog.ProductArchived;
import pl.shop.catalog.ProductId;
import pl.shop.catalog.ProductRepository;

import static io.vavr.control.Either.left;

public class ArchiveProductService {

    private final ProductRepository productRepository;

    public ArchiveProductService(ProductRepository productRepository) {
        this.productRepository = productRepository;
    }

    public Either<String, ProductArchived> archive(ProductId productId) {
        return productRepository.findById(productId)
                .map(Product::archive)
                .orElse(left("Product not found: " + productId));
    }
}
