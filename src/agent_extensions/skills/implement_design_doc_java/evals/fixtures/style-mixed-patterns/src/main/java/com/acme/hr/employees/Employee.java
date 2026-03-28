package com.acme.hr.employees;

public class Employee {

    private EmployeeId id;
    private String firstName;
    private String lastName;
    private String department;

    public Employee() {}

    public Employee(EmployeeId id, String firstName, String lastName, String department) {
        this.id = id;
        this.firstName = firstName;
        this.lastName = lastName;
        this.department = department;
    }

    public EmployeeId getId() { return id; }
    public void setId(EmployeeId id) { this.id = id; }

    public String getFirstName() { return firstName; }
    public void setFirstName(String firstName) { this.firstName = firstName; }

    public String getLastName() { return lastName; }
    public void setLastName(String lastName) { this.lastName = lastName; }

    public String getDepartment() { return department; }
    public void setDepartment(String department) { this.department = department; }
}
