package com.acme.hr.payroll.domain;

import com.acme.hr.employees.EmployeeId;
import io.vavr.control.Either;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

import static io.vavr.control.Either.left;
import static io.vavr.control.Either.right;

public class PayrollRun {

    private final PayrollRunId id;
    private final YearMonth month;
    private final List<Payslip> payslips;
    private PayrollStatus status;

    private PayrollRun(PayrollRunId id, YearMonth month) {
        this.id = id;
        this.month = month;
        this.payslips = new ArrayList<>();
        this.status = PayrollStatus.DRAFT;
    }

    public static PayrollRun create(YearMonth month) {
        return new PayrollRun(PayrollRunId.generate(), month);
    }

    public Either<String, Void> addPayslip(EmployeeId employeeId, Salary salary) {
        if (status == PayrollStatus.EXECUTED) {
            return left("An executed payroll run cannot be modified");
        }
        payslips.add(new Payslip(employeeId, salary));
        return right(null);
    }

    public Either<String, PayrollExecuted> execute() {
        if (status == PayrollStatus.EXECUTED) {
            return left("A payroll run can only be executed once");
        }
        if (payslips.isEmpty()) {
            return left("A payroll run must contain at least one payslip before execution");
        }
        BigDecimal totalNetPay = payslips.stream()
                .map(payslip -> payslip.salary().netPay())
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        payslips.forEach(Payslip::markPaid);
        this.status = PayrollStatus.EXECUTED;
        return right(new PayrollExecuted(id, month, totalNetPay, Instant.now()));
    }

    public PayrollRunId id() {
        return id;
    }

    public YearMonth month() {
        return month;
    }

    public List<Payslip> payslips() {
        return Collections.unmodifiableList(payslips);
    }

    public PayrollStatus status() {
        return status;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        PayrollRun that = (PayrollRun) o;
        return Objects.equals(id, that.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }
}
