package com.example.orders.shipping.domain;

import lombok.Value;

@Value
public class ShippingAddress {
    String street;
    String city;
    String postalCode;
    String country;

    public ShippingAddress(String street, String city, String postalCode, String country) {
        if (street == null || street.isBlank()) {
            throw new IllegalArgumentException("Street must not be empty");
        }
        if (city == null || city.isBlank()) {
            throw new IllegalArgumentException("City must not be empty");
        }
        if (postalCode == null || postalCode.isBlank()) {
            throw new IllegalArgumentException("Postal code must not be empty");
        }
        this.street = street;
        this.city = city;
        this.postalCode = postalCode;
        this.country = country;
    }
}
