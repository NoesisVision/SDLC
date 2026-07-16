package com.example.orders.fulfillment.domain;

import com.example.orders.domain.OrderId;

import java.util.Optional;

public interface FulfillmentRepository {
    void save(Fulfillment fulfillment);
    Optional<Fulfillment> findById(FulfillmentId id);
    Optional<Fulfillment> findByOrderId(OrderId orderId);
}
