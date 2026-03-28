package net.ecom.sales.returns;

import net.ecom.sales.orders.Order;
import net.ecom.sales.shared.Money;
import net.ecom.sales.shared.OrderId;

public final class SubmitReturnHandler {

    private final Order.Repository orderRepository;
    private final ReturnRequest.Repository returnRequestRepository;

    public SubmitReturnHandler(Order.Repository orderRepository, ReturnRequest.Repository returnRequestRepository) {
        this.orderRepository = orderRepository;
        this.returnRequestRepository = returnRequestRepository;
    }

    public void handle(OrderId orderId, Money orderTotal) {
        var order = orderRepository.findById(orderId);
        if (order == null) throw new IllegalArgumentException("Order not found");
        if (!order.isPaid()) throw new IllegalStateException("Only paid orders can be returned");

        var returnRequest = ReturnRequest.submit(orderId, orderTotal);
        returnRequestRepository.save(returnRequest);
    }
}
