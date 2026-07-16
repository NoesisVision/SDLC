package com.acme.hr.employees;

import java.util.UUID;

public class EmployeeId {

    private UUID value;

    public EmployeeId() {}

    public EmployeeId(UUID value) {
        this.value = value;
    }

    public UUID getValue() {
        return value;
    }

    public void setValue(UUID value) {
        this.value = value;
    }

    public static EmployeeId generate() {
        return new EmployeeId(UUID.randomUUID());
    }
}
