package com.acme.hr.leave.domain;

import com.acme.hr.employees.EmployeeId;
import io.vavr.control.Either;

import java.util.Objects;

import static io.vavr.control.Either.left;
import static io.vavr.control.Either.right;

public class LeaveRequest {

    enum Status { PENDING, APPROVED, REJECTED }

    private final LeaveRequestId id;
    private final EmployeeId employeeId;
    private final DateRange period;
    private Status status;

    private LeaveRequest(LeaveRequestId id, EmployeeId employeeId, DateRange period) {
        this.id = id;
        this.employeeId = employeeId;
        this.period = period;
        this.status = Status.PENDING;
    }

    public static LeaveRequest submit(EmployeeId employeeId, DateRange period) {
        return new LeaveRequest(LeaveRequestId.generate(), employeeId, period);
    }

    public Either<String, LeaveApproved> approve() {
        if (status != Status.PENDING) {
            return left("Only pending requests can be approved");
        }
        this.status = Status.APPROVED;
        return right(new LeaveApproved(id, employeeId, period));
    }

    public Either<String, LeaveRejected> reject(String reason) {
        if (status != Status.PENDING) {
            return left("Only pending requests can be rejected");
        }
        this.status = Status.REJECTED;
        return right(new LeaveRejected(id, reason));
    }

    public LeaveRequestId id() { return id; }
    public EmployeeId employeeId() { return employeeId; }
    public DateRange period() { return period; }
    public boolean isPending() { return status == Status.PENDING; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        LeaveRequest that = (LeaveRequest) o;
        return Objects.equals(id, that.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }
}
