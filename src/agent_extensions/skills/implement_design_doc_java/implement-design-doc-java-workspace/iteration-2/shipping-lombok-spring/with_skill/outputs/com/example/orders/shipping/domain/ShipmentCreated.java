package com.example.orders.shipping.domain;

import com.example.orders.domain.DomainEvent;
import com.example.orders.domain.OrderId;
import lombok.Value;

import java.time.Instant;

@Value
public class ShipmentCreated implements DomainEvent {
    ShipmentId shipmentId;
    OrderId orderId;
    Instant createdAt;
}
