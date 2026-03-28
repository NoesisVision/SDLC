package com.acme.hr.payroll.domain;

import java.util.Objects;
import java.util.UUID;

public final class EmployeeId {

    private final UUID value;

    private EmployeeId(UUID value) {
        Objects.requireNonNull(value);
        this.value = value;
    }

    public static EmployeeId of(UUID value) {
        return new EmployeeId(value);
    }

    public static EmployeeId generate() {
        return new EmployeeId(UUID.randomUUID());
    }

    public UUID value() {
        return value;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        EmployeeId that = (EmployeeId) o;
        return Objects.equals(value, that.value);
    }

    @Override
    public int hashCode() {
        return Objects.hash(value);
    }
}
