package com.example.orders.shipping.domain;

import com.example.orders.domain.DomainEvent;
import com.example.orders.domain.OrderId;
import lombok.Getter;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Getter
public class Shipment {

    private final ShipmentId id;
    private final OrderId orderId;
    private final ShippingAddress address;
    private TrackingNumber trackingNumber;
    private ShipmentStatus status;
    private final List<DomainEvent> pendingEvents = new ArrayList<>();

    private Shipment(ShipmentId id, OrderId orderId, ShippingAddress address) {
        this.id = id;
        this.orderId = orderId;
        this.address = address;
        this.status = ShipmentStatus.CREATED;
    }

    public static Shipment createForOrder(OrderId orderId, ShippingAddress address) {
        ShipmentId id = ShipmentId.generate();
        Shipment shipment = new Shipment(id, orderId, address);
        shipment.pendingEvents.add(new ShipmentCreated(id, orderId, Instant.now()));
        return shipment;
    }

    public void assignTrackingNumber(TrackingNumber trackingNumber) {
        this.trackingNumber = trackingNumber;
    }

    public void dispatch() {
        if (trackingNumber == null) {
            throw new IllegalStateException("Cannot dispatch shipment without a tracking number");
        }
        if (status == ShipmentStatus.DELIVERED) {
            throw new IllegalStateException("A delivered shipment cannot be dispatched again");
        }
        this.status = ShipmentStatus.DISPATCHED;
        pendingEvents.add(new ShipmentDispatched(id, trackingNumber, Instant.now()));
    }

    public void confirmDelivery() {
        if (status == ShipmentStatus.DELIVERED) {
            throw new IllegalStateException("Shipment is already delivered");
        }
        this.status = ShipmentStatus.DELIVERED;
    }

    public List<DomainEvent> flushEvents() {
        List<DomainEvent> events = List.copyOf(pendingEvents);
        pendingEvents.clear();
        return events;
    }
}
