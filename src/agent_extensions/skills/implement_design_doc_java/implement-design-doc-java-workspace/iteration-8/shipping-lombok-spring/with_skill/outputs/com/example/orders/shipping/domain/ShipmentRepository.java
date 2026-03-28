package com.example.orders.shipping.domain;

import java.util.Optional;

public interface ShipmentRepository {
    void save(Shipment shipment);
    Optional<Shipment> findById(ShipmentId id);
}
