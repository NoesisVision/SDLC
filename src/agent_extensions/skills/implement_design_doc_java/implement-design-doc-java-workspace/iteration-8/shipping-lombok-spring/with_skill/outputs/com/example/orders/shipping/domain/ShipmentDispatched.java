package com.example.orders.shipping.domain;

import com.example.orders.domain.DomainEvent;
import lombok.Value;

import java.time.Instant;

@Value
public class ShipmentDispatched implements DomainEvent {
    ShipmentId shipmentId;
    TrackingNumber trackingNumber;
    Instant dispatchedAt;
}
