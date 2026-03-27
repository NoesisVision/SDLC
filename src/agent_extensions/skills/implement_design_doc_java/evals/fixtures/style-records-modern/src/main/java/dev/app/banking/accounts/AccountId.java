package dev.app.banking.accounts;

import java.util.UUID;

public record AccountId(UUID value) {

    public AccountId {
        if (value == null) throw new IllegalArgumentException("AccountId cannot be null");
    }

    public static AccountId generate() {
        return new AccountId(UUID.randomUUID());
    }
}
