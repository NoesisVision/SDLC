package dev.app.banking.accounts;

import java.util.Optional;

public interface AccountRepository {
    void save(Account account);
    Optional<Account> findById(AccountId id);
}
