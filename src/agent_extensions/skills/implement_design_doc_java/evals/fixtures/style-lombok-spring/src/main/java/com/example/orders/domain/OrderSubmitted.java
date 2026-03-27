package com.example.orders.domain;

import lombok.Value;

import java.time.Instant;

@Value
public class OrderSubmitted implements DomainEvent {
    OrderId orderId;
    Money total;
    Instant submittedAt;
}
