package com.example.orders.shipping.application;

import com.example.orders.domain.OrderId;
import com.example.orders.shipping.domain.Shipment;
import com.example.orders.shipping.domain.ShipmentId;
import com.example.orders.shipping.domain.ShipmentRepository;
import com.example.orders.shipping.domain.ShippingAddress;

import java.util.Optional;

public class ShippingFacade {

    private final CreateShipmentService createShipmentService;
    private final DispatchShipmentService dispatchShipmentService;
    private final ShipmentRepository shipmentRepository;

    ShippingFacade(CreateShipmentService createShipmentService,
                   DispatchShipmentService dispatchShipmentService,
                   ShipmentRepository shipmentRepository) {
        this.createShipmentService = createShipmentService;
        this.dispatchShipmentService = dispatchShipmentService;
        this.shipmentRepository = shipmentRepository;
    }

    public ShipmentId createShipment(OrderId orderId, ShippingAddress address) {
        return createShipmentService.create(orderId, address);
    }

    public void dispatchShipment(ShipmentId shipmentId) {
        dispatchShipmentService.dispatch(shipmentId);
    }

    public Optional<Shipment> findShipment(ShipmentId shipmentId) {
        return shipmentRepository.findById(shipmentId);
    }
}
