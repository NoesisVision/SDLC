package com.example.orders.fulfillment.application;

import com.example.orders.domain.DomainEventPublisher;
import com.example.orders.domain.OrderId;
import com.example.orders.fulfillment.domain.Fulfillment;
import com.example.orders.fulfillment.domain.FulfillmentId;
import com.example.orders.fulfillment.domain.FulfillmentRepository;

class StartFulfillmentService {

    private final FulfillmentRepository fulfillmentRepository;
    private final DomainEventPublisher eventPublisher;

    StartFulfillmentService(FulfillmentRepository fulfillmentRepository,
                            DomainEventPublisher eventPublisher) {
        this.fulfillmentRepository = fulfillmentRepository;
        this.eventPublisher = eventPublisher;
    }

    FulfillmentId start(OrderId orderId) {
        Fulfillment fulfillment = Fulfillment.startFor(orderId);
        fulfillmentRepository.save(fulfillment);
        fulfillment.flushEvents().forEach(eventPublisher::publish);
        return fulfillment.getId();
    }
}
