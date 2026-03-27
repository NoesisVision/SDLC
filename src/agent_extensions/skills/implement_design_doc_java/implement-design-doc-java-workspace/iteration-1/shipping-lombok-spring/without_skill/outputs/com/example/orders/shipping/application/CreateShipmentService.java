package com.example.orders.shipping.application;

import com.example.orders.domain.DomainEventPublisher;
import com.example.orders.domain.OrderId;
import com.example.orders.shipping.domain.Shipment;
import com.example.orders.shipping.domain.ShipmentId;
import com.example.orders.shipping.domain.ShipmentRepository;
import com.example.orders.shipping.domain.ShippingAddress;

import java.time.Clock;
import java.time.Instant;

class CreateShipmentService {

    private final ShipmentRepository shipmentRepository;
    private final DomainEventPublisher eventPublisher;
    private final Clock clock;

    CreateShipmentService(ShipmentRepository shipmentRepository,
                          DomainEventPublisher eventPublisher,
                          Clock clock) {
        this.shipmentRepository = shipmentRepository;
        this.eventPublisher = eventPublisher;
        this.clock = clock;
    }

    ShipmentId create(OrderId orderId, ShippingAddress address) {
        Shipment shipment = Shipment.createForOrder(orderId, address, Instant.now(clock));
        shipmentRepository.save(shipment);
        shipment.flushEvents().forEach(eventPublisher::publish);
        return shipment.getId();
    }
}
