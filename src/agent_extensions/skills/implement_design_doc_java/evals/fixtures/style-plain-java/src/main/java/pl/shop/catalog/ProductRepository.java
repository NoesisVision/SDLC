package pl.shop.catalog;

import java.util.Optional;

public interface ProductRepository {
    void save(Product product);
    Optional<Product> findById(ProductId id);
}
