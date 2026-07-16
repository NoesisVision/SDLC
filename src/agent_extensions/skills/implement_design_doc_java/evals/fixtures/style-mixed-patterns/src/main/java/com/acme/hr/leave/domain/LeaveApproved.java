package com.acme.hr.leave.domain;

import com.acme.hr.employees.EmployeeId;

import java.util.Objects;

public final class LeaveApproved {

    private final LeaveRequestId requestId;
    private final EmployeeId employeeId;
    private final DateRange period;

    LeaveApproved(LeaveRequestId requestId, EmployeeId employeeId, DateRange period) {
        this.requestId = requestId;
        this.employeeId = employeeId;
        this.period = period;
    }

    public LeaveRequestId requestId() { return requestId; }
    public EmployeeId employeeId() { return employeeId; }
    public DateRange period() { return period; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        LeaveApproved that = (LeaveApproved) o;
        return Objects.equals(requestId, that.requestId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(requestId);
    }
}
