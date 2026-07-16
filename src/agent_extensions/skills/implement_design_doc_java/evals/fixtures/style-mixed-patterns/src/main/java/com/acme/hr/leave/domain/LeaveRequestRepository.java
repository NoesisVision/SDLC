package com.acme.hr.leave.domain;

import com.acme.hr.employees.EmployeeId;

import java.util.List;
import java.util.Optional;

public interface LeaveRequestRepository {
    void save(LeaveRequest leaveRequest);
    Optional<LeaveRequest> findById(LeaveRequestId id);
    List<LeaveRequest> findByEmployee(EmployeeId employeeId);
}
