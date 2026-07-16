package com.acme.hr.payroll.domain;

import java.math.BigDecimal;
import java.util.Objects;

public final class Salary {

    private final BigDecimal grossAmount;
    private final BigDecimal deductions;

    private Salary(BigDecimal grossAmount, BigDecimal deductions) {
        if (grossAmount.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException("Salary must be a positive amount");
        }
        if (deductions.compareTo(BigDecimal.ZERO) < 0) {
            throw new IllegalArgumentException("Deductions cannot be negative");
        }
        this.grossAmount = grossAmount;
        this.deductions = deductions;
    }

    public static Salary of(BigDecimal grossAmount, BigDecimal deductions) {
        return new Salary(grossAmount, deductions);
    }

    public BigDecimal netPay() {
        return grossAmount.subtract(deductions);
    }

    public BigDecimal grossAmount() { return grossAmount; }
    public BigDecimal deductions() { return deductions; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Salary salary = (Salary) o;
        return Objects.equals(grossAmount, salary.grossAmount) && Objects.equals(deductions, salary.deductions);
    }

    @Override
    public int hashCode() {
        return Objects.hash(grossAmount, deductions);
    }
}
