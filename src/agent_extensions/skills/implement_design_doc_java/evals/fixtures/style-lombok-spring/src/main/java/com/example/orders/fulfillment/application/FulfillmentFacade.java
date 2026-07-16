package com.example.orders.fulfillment.application;

import com.example.orders.domain.OrderId;
import com.example.orders.fulfillment.domain.Fulfillment;
import com.example.orders.fulfillment.domain.FulfillmentId;
import com.example.orders.fulfillment.domain.FulfillmentRepository;

import java.util.Optional;

public class FulfillmentFacade {

    private final StartFulfillmentService startFulfillmentService;
    private final FulfillmentRepository fulfillmentRepository;

    FulfillmentFacade(StartFulfillmentService startFulfillmentService,
                      FulfillmentRepository fulfillmentRepository) {
        this.startFulfillmentService = startFulfillmentService;
        this.fulfillmentRepository = fulfillmentRepository;
    }

    public FulfillmentId startFulfillment(OrderId orderId) {
        return startFulfillmentService.start(orderId);
    }

    public Optional<Fulfillment> findFulfillment(FulfillmentId id) {
        return fulfillmentRepository.findById(id);
    }
}
