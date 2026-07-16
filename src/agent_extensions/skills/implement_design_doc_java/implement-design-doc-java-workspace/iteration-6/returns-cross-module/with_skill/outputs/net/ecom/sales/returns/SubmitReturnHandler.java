package net.ecom.sales.returns;

import net.ecom.sales.shared.Money;
import net.ecom.sales.shared.OrderId;

public final class SubmitReturnHandler {

    private final ReturnRequest.Repository returnRequestRepository;

    public SubmitReturnHandler(ReturnRequest.Repository returnRequestRepository) {
        this.returnRequestRepository = returnRequestRepository;
    }

    public void handle(OrderId orderId, Money refundAmount, String reason) {
        var returnRequest = ReturnRequest.submit(orderId, refundAmount, reason);
        returnRequestRepository.save(returnRequest);
    }
}
