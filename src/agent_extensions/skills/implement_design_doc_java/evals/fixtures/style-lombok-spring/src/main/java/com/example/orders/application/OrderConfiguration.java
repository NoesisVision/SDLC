package com.example.orders.application;

import com.example.orders.domain.DomainEventPublisher;
import com.example.orders.domain.OrderRepository;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;

@Configuration
class OrderConfiguration {

    @Bean
    OrderFacade orderFacade(CreateOrderService createOrderService,
                            SubmitOrderService submitOrderService,
                            OrderRepository orderRepository) {
        return new OrderFacade(createOrderService, submitOrderService, orderRepository);
    }

    @Bean
    CreateOrderService createOrderService(OrderRepository orderRepository,
                                          DomainEventPublisher eventPublisher,
                                          Clock clock) {
        return new CreateOrderService(orderRepository, eventPublisher, clock);
    }

    @Bean
    SubmitOrderService submitOrderService(OrderRepository orderRepository,
                                          DomainEventPublisher eventPublisher) {
        return new SubmitOrderService(orderRepository, eventPublisher);
    }
}
