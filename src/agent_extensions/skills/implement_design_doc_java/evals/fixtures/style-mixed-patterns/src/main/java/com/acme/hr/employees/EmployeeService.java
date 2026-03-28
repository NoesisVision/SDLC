package com.acme.hr.employees;

public class EmployeeService {

    private final EmployeeRepository employeeRepository;

    public EmployeeService(EmployeeRepository employeeRepository) {
        this.employeeRepository = employeeRepository;
    }

    public void changeDepartment(EmployeeId employeeId, String newDepartment) {
        Employee employee = employeeRepository.findById(employeeId);
        if (employee == null) {
            throw new RuntimeException("Employee not found");
        }
        employee.setDepartment(newDepartment);
        employeeRepository.save(employee);
    }

    public Employee hire(String firstName, String lastName, String department) {
        Employee employee = new Employee(EmployeeId.generate(), firstName, lastName, department);
        employeeRepository.save(employee);
        return employee;
    }
}
