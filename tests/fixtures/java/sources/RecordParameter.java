package com.acme.orders;

import vision.noesis.annotations.ApplicationService;

@ApplicationService
public class OrderHandler {

    public void save(Order record) {
    }

    public void handle(ConsumerRecord<String, Order> record) {
    }

    record Point(int x, int y) {
    }

    public void ok() {
    }
}
