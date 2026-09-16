package com.acme.orders;

import vision.noesis.annotations.AggregateRoot;

@AggregateRoot(a = @X(b = @Y(c = 1)))
@NamedEntityGraph(
    name = "Order.lines",
    attributeNodes = @NamedAttributeNode(value = "lines", subgraph = "l"),
    subgraphs = @NamedSubgraph(name = "l", attributeNodes = @NamedAttributeNode("product")))
public class Order {

    @Foo(a = @B(c = @D(1)))
    public void place() {
    }

    @Scheduled(cron = "0 0 * * * *", zone = "UTC")
    public void expire() {
    }

    @Retry(on = {IllegalStateException.class, @Timeout(seconds = (1 + 2) * 3)})
    public void retry() {
    }
}
