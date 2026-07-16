package com.example.orders.domain;

import lombok.Value;

import java.time.Instant;

@Value
public class OrderCreated implements DomainEvent {
    OrderId orderId;
    Instant createdAt;
}
