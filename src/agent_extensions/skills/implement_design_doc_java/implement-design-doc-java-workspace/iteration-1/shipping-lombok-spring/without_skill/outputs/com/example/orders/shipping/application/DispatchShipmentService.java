package com.example.orders.shipping.application;

import com.example.orders.domain.DomainEventPublisher;
import com.example.orders.shipping.domain.Shipment;
import com.example.orders.shipping.domain.ShipmentId;
import com.example.orders.shipping.domain.ShipmentRepository;

import java.time.Clock;
import java.time.Instant;

class DispatchShipmentService {

    private final ShipmentRepository shipmentRepository;
    private final DomainEventPublisher eventPublisher;
    private final Clock clock;

    DispatchShipmentService(ShipmentRepository shipmentRepository,
                            DomainEventPublisher eventPublisher,
                            Clock clock) {
        this.shipmentRepository = shipmentRepository;
        this.eventPublisher = eventPublisher;
        this.clock = clock;
    }

    void dispatch(ShipmentId shipmentId) {
        Shipment shipment = shipmentRepository.findById(shipmentId)
                .orElseThrow(() -> new IllegalArgumentException("Shipment not found: " + shipmentId));
        shipment.dispatch(Instant.now(clock));
        shipmentRepository.save(shipment);
        shipment.flushEvents().forEach(eventPublisher::publish);
    }
}
