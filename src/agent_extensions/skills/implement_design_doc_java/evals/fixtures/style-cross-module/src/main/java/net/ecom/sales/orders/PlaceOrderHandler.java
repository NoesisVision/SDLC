package net.ecom.sales.orders;

import net.ecom.sales.shared.CustomerId;
import net.ecom.sales.shared.Money;

public final class PlaceOrderHandler {

    private final Order.Repository repository;

    public PlaceOrderHandler(Order.Repository repository) {
        this.repository = repository;
    }

    public void handle(CustomerId customerId, String item, Money price) {
        var order = Order.create(customerId);
        order.addItem(item, price);
        order.place();
        repository.save(order);
    }
}
