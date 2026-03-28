package io.proj.warehouse.receiving;

import java.time.Instant;

public sealed interface ReceivingEvents {

    record ReceivingFinalized(ReceivingNoteId receivingNoteId, int lineCount, Instant finalizedAt) implements ReceivingEvents {}
}
