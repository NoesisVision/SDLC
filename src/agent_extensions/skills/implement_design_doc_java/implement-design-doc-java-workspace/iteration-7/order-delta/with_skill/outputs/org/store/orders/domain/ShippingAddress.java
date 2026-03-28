package org.store.orders.domain;

public record ShippingAddress(String street, String city, String postalCode) {
    public ShippingAddress {
        if (street == null || street.isBlank()) throw new IllegalArgumentException("Street required");
        if (city == null || city.isBlank()) throw new IllegalArgumentException("City required");
        if (postalCode == null || postalCode.isBlank()) throw new IllegalArgumentException("Postal code required");
    }
}
