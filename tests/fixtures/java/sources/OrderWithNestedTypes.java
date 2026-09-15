package com.acme.orders;

public class Order {
    public void place() {}

    @Event
    public record Placed(OrderId id) {
        public boolean isRecent() { return true; }
    }

    private static class Helper {
        public void hidden() {}
    }

    public void cancel() {}
}
