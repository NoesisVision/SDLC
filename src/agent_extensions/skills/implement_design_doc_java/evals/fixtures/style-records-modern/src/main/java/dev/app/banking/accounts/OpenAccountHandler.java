package dev.app.banking.accounts;

import dev.app.banking.shared.CommandHandler;

public final class OpenAccountHandler implements CommandHandler<OpenAccountCommand, AccountId> {

    private final AccountRepository accountRepository;

    public OpenAccountHandler(AccountRepository accountRepository) {
        this.accountRepository = accountRepository;
    }

    @Override
    public AccountId handle(OpenAccountCommand command) {
        var account = Account.open(Amount.of(command.initialDeposit()));
        accountRepository.save(account);
        return account.id();
    }
}
