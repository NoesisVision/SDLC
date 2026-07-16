package com.acme.hr.payroll.domain;

import com.acme.hr.employees.EmployeeId;

import java.util.Objects;

public class Payslip {

    private final EmployeeId employeeId;
    private final Salary salary;
    private boolean paid;

    Payslip(EmployeeId employeeId, Salary salary) {
        this.employeeId = employeeId;
        this.salary = salary;
        this.paid = false;
    }

    void markPaid() {
        this.paid = true;
    }

    public EmployeeId employeeId() { return employeeId; }
    public Salary salary() { return salary; }
    public boolean isPaid() { return paid; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Payslip payslip = (Payslip) o;
        return Objects.equals(employeeId, payslip.employeeId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(employeeId);
    }
}
