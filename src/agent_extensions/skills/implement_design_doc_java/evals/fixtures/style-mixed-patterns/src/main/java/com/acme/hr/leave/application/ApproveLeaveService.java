package com.acme.hr.leave.application;

import com.acme.hr.leave.domain.LeaveApproved;
import com.acme.hr.leave.domain.LeaveRequest;
import com.acme.hr.leave.domain.LeaveRequestId;
import com.acme.hr.leave.domain.LeaveRequestRepository;
import io.vavr.control.Either;

import static io.vavr.control.Either.left;

public class ApproveLeaveService {

    private final LeaveRequestRepository leaveRequestRepository;

    public ApproveLeaveService(LeaveRequestRepository leaveRequestRepository) {
        this.leaveRequestRepository = leaveRequestRepository;
    }

    public Either<String, LeaveApproved> approve(LeaveRequestId requestId) {
        return leaveRequestRepository.findById(requestId)
                .map(LeaveRequest::approve)
                .orElse(left("Leave request not found"));
    }
}
