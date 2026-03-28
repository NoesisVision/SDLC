package com.acme.hr.payroll.application;

import com.acme.hr.payroll.domain.PayrollExecuted;
import com.acme.hr.payroll.domain.PayrollRun;
import com.acme.hr.payroll.domain.PayrollRunId;
import com.acme.hr.payroll.domain.PayrollRunRepository;
import io.vavr.control.Either;

import static io.vavr.control.Either.left;

public class ExecutePayrollService {

    private final PayrollRunRepository payrollRunRepository;

    public ExecutePayrollService(PayrollRunRepository payrollRunRepository) {
        this.payrollRunRepository = payrollRunRepository;
    }

    public Either<String, PayrollExecuted> execute(PayrollRunId payrollRunId) {
        return payrollRunRepository.findById(payrollRunId)
                .map(this::executeAndSave)
                .orElse(left("Payroll run not found"));
    }

    private Either<String, PayrollExecuted> executeAndSave(PayrollRun payrollRun) {
        return payrollRun.execute()
                .peek(event -> payrollRunRepository.save(payrollRun));
    }
}
