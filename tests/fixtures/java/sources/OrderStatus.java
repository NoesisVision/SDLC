package com.acme;

@ValueObject
public enum OrderStatus {
    NEW, PAID { public boolean isFinal() { return true; } };
    public boolean isFinal() { return false; }
}
