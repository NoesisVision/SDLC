package com.example.orders.shipping.domain;

import lombok.Value;

@Value
public class TrackingNumber {
    String value;

    public static TrackingNumber of(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Tracking number cannot be blank");
        }
        return new TrackingNumber(value);
    }
}
