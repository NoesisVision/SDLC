package org.store.orders.application;

import org.store.orders.domain.Order;
import org.store.orders.domain.OrderId;
import org.store.orders.domain.OrderRepository;

public class PlaceOrderService {

    private final OrderRepository orderRepository;

    public PlaceOrderService(OrderRepository orderRepository) {
        this.orderRepository = orderRepository;
    }

    public void place(OrderId orderId) {
        var order = orderRepository.findById(orderId)
                .orElseThrow(() -> new IllegalArgumentException("Order not found"));
        order.place();
        orderRepository.save(order);
    }
}
