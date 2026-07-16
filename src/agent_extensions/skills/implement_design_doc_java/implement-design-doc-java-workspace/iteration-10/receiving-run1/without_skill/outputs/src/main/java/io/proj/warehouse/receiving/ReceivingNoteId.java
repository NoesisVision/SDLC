package io.proj.warehouse.receiving;

import java.util.Objects;
import java.util.UUID;

public record ReceivingNoteId(UUID value) {
    public ReceivingNoteId {
        Objects.requireNonNull(value);
    }

    public static ReceivingNoteId generate() {
        return new ReceivingNoteId(UUID.randomUUID());
    }
}
