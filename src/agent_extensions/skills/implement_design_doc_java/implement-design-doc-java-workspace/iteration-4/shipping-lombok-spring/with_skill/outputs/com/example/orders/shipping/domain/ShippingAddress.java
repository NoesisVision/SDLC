package com.example.orders.shipping.domain;

import lombok.Value;

@Value
public class ShippingAddress {
    String street;
    String city;
    String postalCode;
    String country;

    public static ShippingAddress of(String street, String city, String postalCode, String country) {
        if (street == null || street.isBlank()) {
            throw new IllegalArgumentException("Street is required");
        }
        if (city == null || city.isBlank()) {
            throw new IllegalArgumentException("City is required");
        }
        if (postalCode == null || postalCode.isBlank()) {
            throw new IllegalArgumentException("Postal code is required");
        }
        return new ShippingAddress(street, city, postalCode, country);
    }
}
