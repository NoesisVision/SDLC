package dev.app.banking.transfers;

import java.time.Instant;

public record TransferCompleted(
        TransferId transferId,
        Instant completedAt
) implements Transfer.Event {
}
