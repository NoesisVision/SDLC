package net.ecom.sales.orders;

import net.ecom.sales.shared.CustomerId;
import net.ecom.sales.shared.Money;
import net.ecom.sales.shared.OrderId;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

public final class Order {

    public sealed interface Event permits OrderPlaced, OrderPaid {}
    public record OrderPlaced(OrderId orderId, CustomerId customerId, Money total, Instant placedAt) implements Event {}
    public record OrderPaid(OrderId orderId, Instant paidAt) implements Event {}

    enum Status { DRAFT, PLACED, PAID }

    private final OrderId id;
    private final CustomerId customerId;
    private final List<String> items = new ArrayList<>();
    private Status status = Status.DRAFT;
    private Money total = Money.zero("USD");
    private final List<Event> pendingEvents = new ArrayList<>();

    private Order(OrderId id, CustomerId customerId) {
        this.id = id;
        this.customerId = customerId;
    }

    public static Order create(CustomerId customerId) {
        return new Order(OrderId.generate(), customerId);
    }

    public void addItem(String item, Money price) {
        items.add(item);
        total = total.add(price);
    }

    public void place() {
        if (items.isEmpty()) throw new IllegalStateException("Cannot place empty order");
        this.status = Status.PLACED;
        pendingEvents.add(new OrderPlaced(id, customerId, total, Instant.now()));
    }

    public void markPaid() {
        if (status != Status.PLACED) throw new IllegalStateException("Only placed orders can be paid");
        this.status = Status.PAID;
        pendingEvents.add(new OrderPaid(id, Instant.now()));
    }

    public OrderId id() { return id; }
    public CustomerId customerId() { return customerId; }
    public Money total() { return total; }
    public boolean isPaid() { return status == Status.PAID; }

    public List<Event> flushEvents() {
        var events = List.copyOf(pendingEvents);
        pendingEvents.clear();
        return events;
    }

    public interface Repository {
        void save(Order order);
        Order findById(OrderId id);
    }
}
