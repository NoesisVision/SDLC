package dev.app.banking.transfers;

import dev.app.banking.accounts.AccountId;
import dev.app.banking.accounts.Amount;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

public final class Transfer {

    sealed interface Event permits TransferInitiated, TransferCompleted {}

    private final TransferId id;
    private final AccountId sourceAccountId;
    private final AccountId destinationAccountId;
    private final Amount amount;
    private TransferStatus status;
    private final Instant initiatedAt;
    private final List<Event> pendingEvents = new ArrayList<>();

    private Transfer(TransferId id, AccountId sourceAccountId, AccountId destinationAccountId, Amount amount, TransferStatus status, Instant initiatedAt) {
        this.id = id;
        this.sourceAccountId = sourceAccountId;
        this.destinationAccountId = destinationAccountId;
        this.amount = amount;
        this.status = status;
        this.initiatedAt = initiatedAt;
    }

    public static Transfer initiate(AccountId sourceAccountId, AccountId destinationAccountId, Amount amount) {
        if (sourceAccountId.equals(destinationAccountId)) {
            throw new IllegalArgumentException("Source and destination accounts must be different");
        }
        if (amount.isNegative() || amount.equals(Amount.zero())) {
            throw new IllegalArgumentException("Transfer amount must be positive");
        }
        var id = TransferId.generate();
        var now = Instant.now();
        var transfer = new Transfer(id, sourceAccountId, destinationAccountId, amount, TransferStatus.INITIATED, now);
        transfer.pendingEvents.add(new TransferInitiated(id, sourceAccountId, destinationAccountId, amount, now));
        return transfer;
    }

    public void complete() {
        if (status != TransferStatus.INITIATED) {
            throw new IllegalStateException("A completed transfer cannot be modified");
        }
        this.status = TransferStatus.COMPLETED;
        pendingEvents.add(new TransferCompleted(id, Instant.now()));
    }

    public void fail() {
        if (status != TransferStatus.INITIATED) {
            throw new IllegalStateException("A completed transfer cannot be modified");
        }
        this.status = TransferStatus.FAILED;
    }

    public TransferId id() { return id; }
    public AccountId sourceAccountId() { return sourceAccountId; }
    public AccountId destinationAccountId() { return destinationAccountId; }
    public Amount amount() { return amount; }
    public TransferStatus status() { return status; }
    public Instant initiatedAt() { return initiatedAt; }

    public List<Event> flushEvents() {
        var events = List.copyOf(pendingEvents);
        pendingEvents.clear();
        return events;
    }
}
