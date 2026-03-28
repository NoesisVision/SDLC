package com.example.orders.shipping.application;

import com.example.orders.domain.DomainEventPublisher;
import com.example.orders.shipping.domain.Shipment;
import com.example.orders.shipping.domain.ShipmentId;
import com.example.orders.shipping.domain.ShipmentRepository;

class DispatchShipmentService {

    private final ShipmentRepository shipmentRepository;
    private final DomainEventPublisher eventPublisher;

    DispatchShipmentService(ShipmentRepository shipmentRepository,
                            DomainEventPublisher eventPublisher) {
        this.shipmentRepository = shipmentRepository;
        this.eventPublisher = eventPublisher;
    }

    void dispatch(ShipmentId shipmentId) {
        Shipment shipment = shipmentRepository.findById(shipmentId)
                .orElseThrow(() -> new IllegalArgumentException("Shipment not found: " + shipmentId));
        shipment.dispatch();
        shipmentRepository.save(shipment);
        shipment.flushEvents().forEach(eventPublisher::publish);
    }
}
