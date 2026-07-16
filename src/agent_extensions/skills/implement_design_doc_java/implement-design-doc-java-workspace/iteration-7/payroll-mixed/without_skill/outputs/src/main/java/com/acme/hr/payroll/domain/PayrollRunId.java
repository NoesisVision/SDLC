package com.acme.hr.payroll.domain;

import java.util.Objects;
import java.util.UUID;

public final class PayrollRunId {

    private final UUID value;

    private PayrollRunId(UUID value) {
        Objects.requireNonNull(value);
        this.value = value;
    }

    public static PayrollRunId of(UUID value) {
        return new PayrollRunId(value);
    }

    public static PayrollRunId generate() {
        return new PayrollRunId(UUID.randomUUID());
    }

    public UUID value() {
        return value;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        PayrollRunId that = (PayrollRunId) o;
        return Objects.equals(value, that.value);
    }

    @Override
    public int hashCode() {
        return Objects.hash(value);
    }
}
