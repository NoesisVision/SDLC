package com.example.orders.domain;

import lombok.Value;

import java.util.UUID;

@Value
public class ProductId {
    UUID value;

    public static ProductId of(UUID value) {
        return new ProductId(value);
    }
}
