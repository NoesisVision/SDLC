package com.example.orders.application;

import com.example.orders.domain.Order;
import com.example.orders.domain.OrderId;
import com.example.orders.domain.OrderRepository;

import java.util.Optional;

public class OrderFacade {

    private final CreateOrderService createOrderService;
    private final SubmitOrderService submitOrderService;
    private final OrderRepository orderRepository;

    OrderFacade(CreateOrderService createOrderService,
                SubmitOrderService submitOrderService,
                OrderRepository orderRepository) {
        this.createOrderService = createOrderService;
        this.submitOrderService = submitOrderService;
        this.orderRepository = orderRepository;
    }

    public OrderId createOrder() {
        return createOrderService.create();
    }

    public void submitOrder(OrderId orderId) {
        submitOrderService.submit(orderId);
    }

    public Optional<Order> findOrder(OrderId orderId) {
        return orderRepository.findById(orderId);
    }
}
