package com.example.orders.fulfillment.domain;

import lombok.Value;

import java.util.UUID;

@Value
public class FulfillmentId {
    UUID value;

    public static FulfillmentId generate() {
        return new FulfillmentId(UUID.randomUUID());
    }
}
