package com.example.orders.domain;

import lombok.Value;

import java.util.UUID;

@Value
public class OrderId {
    UUID value;

    public static OrderId generate() {
        return new OrderId(UUID.randomUUID());
    }

    public static OrderId of(UUID value) {
        return new OrderId(value);
    }
}
