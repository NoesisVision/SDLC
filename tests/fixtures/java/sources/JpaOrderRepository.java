package com.acme;

// Each line is a trap the scanner must step over; the spec asserts what
// survives: one type, four annotations by simple name, one method.

// A fully qualified Noesis annotation, no import: read as `Adapter`.
@vision.noesis.annotations.Adapter(Direction.SECONDARY)
// Braces and type keywords inside an annotation argument.
@SuppressWarnings({"unchecked", "class interface enum"})
// An annotation nested in an argument is never read; `Component` is no stereotype.
@Component(value = "orders", scope = @Scope("singleton"))
public final class JpaOrderRepository extends JpaBase implements OrderRepository {
    // `Order.class` is a class literal, not a declaration.
    private static final Class<?> TYPE = Order.class;
    // `@interface` declares an annotation type, not an interface.
    public @interface Marker {}
    public void save(Order order) {}
}
