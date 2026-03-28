package com.acme.hr.payroll.application;

import com.acme.hr.payroll.domain.PayrollExecuted;
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
                .map(payrollRun -> {
                    Either<String, PayrollExecuted> result = payrollRun.execute();
                    result.peek(event -> payrollRunRepository.save(payrollRun));
                    return result;
                })
                .orElse(left("Payroll run not found"));
    }
}
