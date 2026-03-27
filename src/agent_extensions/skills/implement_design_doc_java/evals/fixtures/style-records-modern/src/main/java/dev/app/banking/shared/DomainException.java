package dev.app.banking.shared;

public class DomainException extends RuntimeException {

    public DomainException(String message) {
        super(message);
    }
}
