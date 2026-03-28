package com.acme.hr.leave.domain;

import java.util.Objects;
import java.util.UUID;

public final class LeaveRequestId {

    private final UUID value;

    private LeaveRequestId(UUID value) {
        Objects.requireNonNull(value);
        this.value = value;
    }

    public static LeaveRequestId of(UUID value) {
        return new LeaveRequestId(value);
    }

    public static LeaveRequestId generate() {
        return new LeaveRequestId(UUID.randomUUID());
    }

    public UUID value() {
        return value;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        LeaveRequestId that = (LeaveRequestId) o;
        return Objects.equals(value, that.value);
    }

    @Override
    public int hashCode() {
        return Objects.hash(value);
    }
}
