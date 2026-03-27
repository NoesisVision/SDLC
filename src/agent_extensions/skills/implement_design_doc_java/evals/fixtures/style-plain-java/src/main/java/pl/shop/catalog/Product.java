package pl.shop.catalog;

import io.vavr.control.Either;

import java.util.Objects;

import static io.vavr.control.Either.left;
import static io.vavr.control.Either.right;

public class Product {

    private final ProductId id;
    private ProductName name;
    private ProductStatus status;

    Product(ProductId id, ProductName name) {
        this.id = id;
        this.name = name;
        this.status = ProductStatus.DRAFT;
    }

    public static Product create(ProductName name) {
        return new Product(ProductId.newOne(), name);
    }

    public Either<String, ProductPublished> publish() {
        if (status != ProductStatus.DRAFT) {
            return left("Only draft products can be published");
        }
        this.status = ProductStatus.PUBLISHED;
        return right(new ProductPublished(id));
    }

    public Either<String, ProductArchived> archive() {
        if (status == ProductStatus.ARCHIVED) {
            return left("Product is already archived");
        }
        this.status = ProductStatus.ARCHIVED;
        return right(new ProductArchived(id));
    }

    public ProductId id() {
        return id;
    }

    public ProductName name() {
        return name;
    }

    public boolean isPublished() {
        return status == ProductStatus.PUBLISHED;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Product product = (Product) o;
        return Objects.equals(id, product.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }
}
