package com.acme.hr.leave.domain;

import java.time.LocalDate;
import java.util.Objects;

public final class DateRange {

    private final LocalDate from;
    private final LocalDate to;

    private DateRange(LocalDate from, LocalDate to) {
        if (from.isAfter(to)) {
            throw new IllegalArgumentException("Start date must be before end date");
        }
        this.from = from;
        this.to = to;
    }

    public static DateRange of(LocalDate from, LocalDate to) {
        return new DateRange(from, to);
    }

    public int days() {
        return (int) (to.toEpochDay() - from.toEpochDay()) + 1;
    }

    public boolean overlaps(DateRange other) {
        return !this.from.isAfter(other.to) && !this.to.isBefore(other.from);
    }

    public LocalDate from() { return from; }
    public LocalDate to() { return to; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        DateRange dateRange = (DateRange) o;
        return Objects.equals(from, dateRange.from) && Objects.equals(to, dateRange.to);
    }

    @Override
    public int hashCode() {
        return Objects.hash(from, to);
    }
}
