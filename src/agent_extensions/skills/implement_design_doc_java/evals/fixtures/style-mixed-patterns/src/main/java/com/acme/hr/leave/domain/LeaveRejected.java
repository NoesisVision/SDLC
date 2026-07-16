package com.acme.hr.leave.domain;

import java.util.Objects;

public final class LeaveRejected {

    private final LeaveRequestId requestId;
    private final String reason;

    LeaveRejected(LeaveRequestId requestId, String reason) {
        this.requestId = requestId;
        this.reason = reason;
    }

    public LeaveRequestId requestId() { return requestId; }
    public String reason() { return reason; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        LeaveRejected that = (LeaveRejected) o;
        return Objects.equals(requestId, that.requestId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(requestId);
    }
}
