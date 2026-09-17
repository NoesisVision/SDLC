package com.acme.sales;

// A fully annotated aggregate under src/test: exactly what would surface were tests scanned.
@AggregateRoot
public class OrderInTestNotForScanning { public void notScanned() {} }
