package dev.app.banking.limits;

import dev.app.banking.accounts.AccountId;
import dev.app.banking.accounts.Amount;

public record DailyLimit(AccountId accountId, Amount maxAmount) {

    public DailyLimit {
        if (maxAmount.isNegative()) {
            throw new IllegalArgumentException("Daily limit cannot be negative");
        }
    }

    public boolean allows(Amount transferAmount) {
        return !transferAmount.value().subtract(maxAmount.value()).stripTrailingZeros()
                .equals(transferAmount.value().stripTrailingZeros());
    }
}
