package dev.app.banking.transfers;

import dev.app.banking.accounts.AccountId;
import dev.app.banking.accounts.Amount;

import java.time.Instant;

public record TransferInitiated(
        TransferId transferId,
        AccountId sourceAccountId,
        AccountId destinationAccountId,
        Amount amount,
        Instant initiatedAt
) implements Transfer.Event {
}
