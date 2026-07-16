package net.ecom.fulfillment.returnprocessing;

import net.ecom.sales.shared.ReturnRequestId;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

public final class ReturnReceipt {

    public sealed interface Event permits ReturnReceived {}
    public record ReturnReceived(ReturnReceiptId returnReceiptId, ReturnRequestId returnRequestId, Instant receivedAt) implements Event {}

    private final ReturnReceiptId id;
    private final ReturnRequestId returnRequestId;
    private Instant receivedAt;
    private boolean inspected = false;
    private final List<Event> pendingEvents = new ArrayList<>();

    private ReturnReceipt(ReturnReceiptId id, ReturnRequestId returnRequestId, Instant receivedAt) {
        this.id = id;
        this.returnRequestId = returnRequestId;
        this.receivedAt = receivedAt;
    }

    public static ReturnReceipt receive(ReturnRequestId returnRequestId) {
        var id = ReturnReceiptId.generate();
        var receivedAt = Instant.now();
        var receipt = new ReturnReceipt(id, returnRequestId, receivedAt);
        receipt.pendingEvents.add(new ReturnReceived(id, returnRequestId, receivedAt));
        return receipt;
    }

    public void inspect() {
        this.inspected = true;
    }

    public ReturnReceiptId id() { return id; }
    public ReturnRequestId returnRequestId() { return returnRequestId; }
    public Instant receivedAt() { return receivedAt; }
    public boolean inspected() { return inspected; }

    public List<Event> flushEvents() {
        var events = List.copyOf(pendingEvents);
        pendingEvents.clear();
        return events;
    }

    public interface Repository {
        void save(ReturnReceipt returnReceipt);
        ReturnReceipt findById(ReturnReceiptId id);
    }
}
