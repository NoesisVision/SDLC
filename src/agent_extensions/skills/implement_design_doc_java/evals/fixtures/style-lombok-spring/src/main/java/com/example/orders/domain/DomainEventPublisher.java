package com.example.orders.domain;

public interface DomainEventPublisher {
    void publish(DomainEvent event);
}
