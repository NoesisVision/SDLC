package com.acme.hr.payroll.domain;

import java.util.Optional;

public interface PayrollRunRepository {
    void save(PayrollRun payrollRun);
    Optional<PayrollRun> findById(PayrollRunId id);
}
