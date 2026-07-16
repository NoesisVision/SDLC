package com.example.orders.shipping.application;

import com.example.orders.domain.DomainEventPublisher;
import com.example.orders.domain.OrderId;
import com.example.orders.shipping.domain.Shipment;
import com.example.orders.shipping.domain.ShipmentId;
import com.example.orders.shipping.domain.ShipmentRepository;
import com.example.orders.shipping.domain.ShippingAddress;

class CreateShipmentService {

    private final ShipmentRepository shipmentRepository;
    private final DomainEventPublisher eventPublisher;

    CreateShipmentService(ShipmentRepository shipmentRepository,
                          DomainEventPublisher eventPublisher) {
        this.shipmentRepository = shipmentRepository;
        this.eventPublisher = eventPublisher;
    }

    ShipmentId create(ShipmentId shipmentId, ShippingAddress address, OrderId orderId) {
        Shipment shipment = Shipment.createForOrder(shipmentId, address, orderId);
        shipmentRepository.save(shipment);
        shipment.flushEvents().forEach(eventPublisher::publish);
        return shipment.getId();
    }
}
