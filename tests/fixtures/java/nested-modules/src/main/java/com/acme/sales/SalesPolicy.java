package com.acme.sales;

@DomainService
public class SalesPolicy {
    public boolean allows(Order order) { return true; }
}
