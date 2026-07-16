package com.example.orders.shipping.domain;

import lombok.Value;

import java.util.UUID;

@Value
public class ShipmentId {
    UUID value;

    public static ShipmentId generate() {
        return new ShipmentId(UUID.randomUUID());
    }

    public static ShipmentId of(UUID value) {
        return new ShipmentId(value);
    }
}
