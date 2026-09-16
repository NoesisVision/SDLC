package com.acme.orders;

import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.springframework.stereotype.Repository;
import vision.noesis.annotations.AggregateRoot;

@Entity
@Table(name = "orders")
public class OrderJpa {
    public String getId() {
        return null;
    }
}

@Repository
public class JpaOrderRepo {
    public void save() {
    }
}

@AggregateRoot
public class Order {
    public void place() {
    }
}

@vision.noesis.annotations.ValueObject
public record Money(int amount) {
}

@jakarta.persistence.Embeddable
class Address {
}
