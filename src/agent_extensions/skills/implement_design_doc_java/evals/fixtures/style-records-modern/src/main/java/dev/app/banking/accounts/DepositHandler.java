package dev.app.banking.accounts;

import dev.app.banking.shared.CommandHandler;
import dev.app.banking.shared.DomainException;

public final class DepositHandler implements CommandHandler<DepositCommand, Void> {

    private final AccountRepository accountRepository;

    public DepositHandler(AccountRepository accountRepository) {
        this.accountRepository = accountRepository;
    }

    @Override
    public Void handle(DepositCommand command) {
        var accountId = new AccountId(command.accountId());
        var account = accountRepository.findById(accountId)
                .orElseThrow(() -> new DomainException("Account not found: " + accountId));
        account.deposit(Amount.of(command.amount()));
        accountRepository.save(account);
        return null;
    }
}
