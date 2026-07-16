package com.acme.hr.employees;

public interface EmployeeRepository {
    Employee findById(EmployeeId id);
    void save(Employee employee);
}
