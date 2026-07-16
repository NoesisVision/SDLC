package net.ecom.sales.returns;

import net.ecom.sales.shared.Money;
import net.ecom.sales.shared.OrderId;
import net.ecom.sales.shared.ReturnRequestId;

import java.util.ArrayList;
import java.util.List;

public final class ReturnRequest {

    public sealed interface Event permits ReturnRequested {}
    public record ReturnRequested(ReturnRequestId returnRequestId, OrderId orderId, Money refundAmount) implements Event {}

    enum Status { PENDING, APPROVED }

    private final ReturnRequestId id;
    private final OrderId orderId;
    private final String reason;
    private final Money refundAmount;
    private Status status = Status.PENDING;
    private final List<Event> pendingEvents = new ArrayList<>();

    private ReturnRequest(ReturnRequestId id, OrderId orderId, String reason, Money refundAmount) {
        this.id = id;
        this.orderId = orderId;
        this.reason = reason;
        this.refundAmount = refundAmount;
    }

    public static ReturnRequest submit(OrderId orderId, Money orderTotal) {
        var request = new ReturnRequest(ReturnRequestId.generate(), orderId, "", orderTotal);
        request.pendingEvents.add(new ReturnRequested(request.id, orderId, orderTotal));
        return request;
    }

    public void approve() {
        if (status != Status.PENDING) throw new IllegalStateException("An approved return cannot be modified");
        this.status = Status.APPROVED;
    }

    public ReturnRequestId id() { return id; }
    public OrderId orderId() { return orderId; }
    public Money refundAmount() { return refundAmount; }
    public boolean isApproved() { return status == Status.APPROVED; }

    public List<Event> flushEvents() {
        var events = List.copyOf(pendingEvents);
        pendingEvents.clear();
        return events;
    }

    public interface Repository {
        void save(ReturnRequest returnRequest);
        ReturnRequest findById(ReturnRequestId id);
    }
}
