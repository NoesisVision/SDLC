package dev.app.banking.limits;

import dev.app.banking.accounts.AccountId;

import java.util.Optional;

public interface LimitRepository {
    Optional<DailyLimit> findByAccountId(AccountId accountId);
    void save(DailyLimit limit);
}
