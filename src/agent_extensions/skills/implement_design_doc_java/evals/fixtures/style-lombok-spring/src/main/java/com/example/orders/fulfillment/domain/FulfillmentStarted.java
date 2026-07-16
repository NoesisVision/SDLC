package com.example.orders.fulfillment.domain;

import com.example.orders.domain.DomainEvent;
import com.example.orders.domain.OrderId;
import lombok.Value;

import java.time.Instant;

@Value
public class FulfillmentStarted implements DomainEvent {
    FulfillmentId fulfillmentId;
    OrderId orderId;
    Instant startedAt;
}
