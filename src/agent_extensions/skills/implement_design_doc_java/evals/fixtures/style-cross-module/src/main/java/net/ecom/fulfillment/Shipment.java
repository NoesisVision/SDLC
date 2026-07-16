package net.ecom.fulfillment;

import net.ecom.sales.shared.OrderId;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public final class Shipment {

    public sealed interface Event permits ShipmentCreated, ShipmentDispatched {}
    public record ShipmentCreated(UUID shipmentId, OrderId orderId, Instant createdAt) implements Event {}
    public record ShipmentDispatched(UUID shipmentId, Instant dispatchedAt) implements Event {}

    private final UUID id;
    private final OrderId orderId;
    private boolean dispatched = false;
    private final List<Event> pendingEvents = new ArrayList<>();

    private Shipment(UUID id, OrderId orderId) {
        this.id = id;
        this.orderId = orderId;
    }

    public static Shipment createFor(OrderId orderId) {
        var id = UUID.randomUUID();
        var shipment = new Shipment(id, orderId);
        shipment.pendingEvents.add(new ShipmentCreated(id, orderId, Instant.now()));
        return shipment;
    }

    public void dispatch() {
        if (dispatched) throw new IllegalStateException("Already dispatched");
        this.dispatched = true;
        pendingEvents.add(new ShipmentDispatched(id, Instant.now()));
    }

    public UUID id() { return id; }
    public OrderId orderId() { return orderId; }

    public List<Event> flushEvents() {
        var events = List.copyOf(pendingEvents);
        pendingEvents.clear();
        return events;
    }

    public interface Repository {
        void save(Shipment shipment);
        Shipment findByOrderId(OrderId orderId);
    }
}
