package com.acme.orders;

import vision.noesis.annotations.AggregateRoot;

/** An order. { not a brace that counts } */
@AggregateRoot
public class Order implements Comparable<Order>, Serializable {

    private final OrderId id;
    private final List<OrderLine> lines = new ArrayList<>();

    public Order(OrderId id) {
        this.id = id;
    }

    public OrderPlaced place(String item) {
        // place() is a behaviour; this comment's "}" is not
        return new OrderPlaced(id, item);
    }

    public <T extends Discount> T apply(T discount) throws DiscountRejected {
        if (discount == null) { throw new DiscountRejected("}"); }
        return discount;
    }

    public static Order draft() {
        return new Order(OrderId.next());
    }

    protected void audit() {}
    private void recompute() {}
    void packagePrivate() {}

    @Override
    public boolean equals(Object other) { return false; }
    @Override
    public int hashCode() { return 0; }
    @Override
    public String toString() { return ""; }
}
