package com.example.orders.fulfillment.domain;

import com.example.orders.domain.DomainEvent;
import com.example.orders.domain.OrderId;
import lombok.Getter;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Getter
public class Fulfillment {

    private final FulfillmentId id;
    private final OrderId orderId;
    private FulfillmentStatus status;
    private final List<DomainEvent> pendingEvents = new ArrayList<>();

    private Fulfillment(FulfillmentId id, OrderId orderId) {
        this.id = id;
        this.orderId = orderId;
        this.status = FulfillmentStatus.PENDING;
    }

    public static Fulfillment startFor(OrderId orderId) {
        FulfillmentId id = FulfillmentId.generate();
        Fulfillment fulfillment = new Fulfillment(id, orderId);
        fulfillment.pendingEvents.add(new FulfillmentStarted(id, orderId, Instant.now()));
        return fulfillment;
    }

    public void markReady() {
        if (status != FulfillmentStatus.PENDING) {
            throw new IllegalStateException("Only pending fulfillments can be marked ready");
        }
        this.status = FulfillmentStatus.READY;
    }

    public List<DomainEvent> flushEvents() {
        List<DomainEvent> events = List.copyOf(pendingEvents);
        pendingEvents.clear();
        return events;
    }
}
