package com.acme.hr.leave.application;

import com.acme.hr.employees.EmployeeId;
import com.acme.hr.leave.domain.DateRange;
import com.acme.hr.leave.domain.LeaveRequest;
import com.acme.hr.leave.domain.LeaveRequestRepository;

public class SubmitLeaveService {

    private final LeaveRequestRepository leaveRequestRepository;

    public SubmitLeaveService(LeaveRequestRepository leaveRequestRepository) {
        this.leaveRequestRepository = leaveRequestRepository;
    }

    public void submit(EmployeeId employeeId, DateRange period) {
        LeaveRequest request = LeaveRequest.submit(employeeId, period);
        leaveRequestRepository.save(request);
    }
}
