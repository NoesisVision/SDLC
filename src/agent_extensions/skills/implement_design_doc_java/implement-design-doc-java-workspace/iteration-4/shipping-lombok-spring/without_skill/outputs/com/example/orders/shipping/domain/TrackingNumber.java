package com.example.orders.shipping.domain;

import lombok.Value;

@Value
public class TrackingNumber {
    String value;

    public TrackingNumber(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Tracking number cannot be blank");
        }
        this.value = value;
    }
}
