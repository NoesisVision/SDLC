package com.acme.hr.payroll.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.YearMonth;
import java.util.Objects;

public final class PayrollExecuted {

    private final PayrollRunId payrollRunId;
    private final YearMonth month;
    private final BigDecimal totalNetPay;
    private final Instant executedAt;

    PayrollExecuted(PayrollRunId payrollRunId, YearMonth month, BigDecimal totalNetPay, Instant executedAt) {
        this.payrollRunId = payrollRunId;
        this.month = month;
        this.totalNetPay = totalNetPay;
        this.executedAt = executedAt;
    }

    public PayrollRunId payrollRunId() {
        return payrollRunId;
    }

    public YearMonth month() {
        return month;
    }

    public BigDecimal totalNetPay() {
        return totalNetPay;
    }

    public Instant executedAt() {
        return executedAt;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        PayrollExecuted that = (PayrollExecuted) o;
        return Objects.equals(payrollRunId, that.payrollRunId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(payrollRunId);
    }
}
