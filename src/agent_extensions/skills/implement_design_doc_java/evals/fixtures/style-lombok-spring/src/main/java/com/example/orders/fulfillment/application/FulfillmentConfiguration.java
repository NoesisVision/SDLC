package com.example.orders.fulfillment.application;

import com.example.orders.domain.DomainEventPublisher;
import com.example.orders.fulfillment.domain.FulfillmentRepository;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
class FulfillmentConfiguration {

    @Bean
    FulfillmentFacade fulfillmentFacade(StartFulfillmentService startFulfillmentService,
                                        FulfillmentRepository fulfillmentRepository) {
        return new FulfillmentFacade(startFulfillmentService, fulfillmentRepository);
    }

    @Bean
    StartFulfillmentService startFulfillmentService(FulfillmentRepository fulfillmentRepository,
                                                     DomainEventPublisher eventPublisher) {
        return new StartFulfillmentService(fulfillmentRepository, eventPublisher);
    }
}
