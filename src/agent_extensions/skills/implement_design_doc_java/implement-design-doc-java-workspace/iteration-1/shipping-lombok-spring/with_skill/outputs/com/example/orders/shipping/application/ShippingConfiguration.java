package com.example.orders.shipping.application;

import com.example.orders.domain.DomainEventPublisher;
import com.example.orders.shipping.domain.ShipmentRepository;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
class ShippingConfiguration {

    @Bean
    ShippingFacade shippingFacade(CreateShipmentService createShipmentService,
                                  DispatchShipmentService dispatchShipmentService,
                                  ShipmentRepository shipmentRepository) {
        return new ShippingFacade(createShipmentService, dispatchShipmentService, shipmentRepository);
    }

    @Bean
    CreateShipmentService createShipmentService(ShipmentRepository shipmentRepository,
                                                DomainEventPublisher eventPublisher) {
        return new CreateShipmentService(shipmentRepository, eventPublisher);
    }

    @Bean
    DispatchShipmentService dispatchShipmentService(ShipmentRepository shipmentRepository,
                                                     DomainEventPublisher eventPublisher) {
        return new DispatchShipmentService(shipmentRepository, eventPublisher);
    }
}
