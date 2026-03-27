package com.example.orders.shipping.domain;

import lombok.Value;

@Value
public class TrackingNumber {
    String value;

    public static TrackingNumber of(String value) {
        return new TrackingNumber(value);
    }
}
