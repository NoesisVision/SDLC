package dev.app.banking.accounts;

import java.util.ArrayList;
import java.util.List;

public final class Account {

    sealed interface Event permits Deposited, Withdrawn, AccountOpened {}
    record AccountOpened(AccountId accountId, Amount initialBalance) implements Event {}
    record Deposited(AccountId accountId, Amount amount) implements Event {}
    record Withdrawn(AccountId accountId, Amount amount) implements Event {}

    private final AccountId id;
    private Amount balance;
    private final List<Event> pendingEvents = new ArrayList<>();

    private Account(AccountId id, Amount balance) {
        this.id = id;
        this.balance = balance;
    }

    public static Account open(Amount initialDeposit) {
        if (initialDeposit.isNegative()) {
            throw new IllegalArgumentException("Initial deposit cannot be negative");
        }
        var id = AccountId.generate();
        var account = new Account(id, initialDeposit);
        account.pendingEvents.add(new AccountOpened(id, initialDeposit));
        return account;
    }

    public void deposit(Amount amount) {
        if (amount.isNegative()) {
            throw new IllegalArgumentException("Deposit amount must be positive");
        }
        this.balance = balance.add(amount);
        pendingEvents.add(new Deposited(id, amount));
    }

    public void withdraw(Amount amount) {
        if (amount.isNegative()) {
            throw new IllegalArgumentException("Withdrawal amount must be positive");
        }
        var newBalance = balance.subtract(amount);
        if (newBalance.isNegative()) {
            throw new IllegalStateException("Insufficient funds");
        }
        this.balance = newBalance;
        pendingEvents.add(new Withdrawn(id, amount));
    }

    public AccountId id() { return id; }
    public Amount balance() { return balance; }

    public List<Event> flushEvents() {
        var events = List.copyOf(pendingEvents);
        pendingEvents.clear();
        return events;
    }
}
