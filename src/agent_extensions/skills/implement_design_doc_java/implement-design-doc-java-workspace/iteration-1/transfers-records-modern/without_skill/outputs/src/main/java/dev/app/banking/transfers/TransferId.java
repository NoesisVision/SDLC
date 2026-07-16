package dev.app.banking.transfers;

import java.util.UUID;

public record TransferId(UUID value) {

    public TransferId {
        if (value == null) throw new IllegalArgumentException("TransferId cannot be null");
    }

    public static TransferId generate() {
        return new TransferId(UUID.randomUUID());
    }
}
