package dev.app.banking.transfers;

import dev.app.banking.accounts.AccountId;
import dev.app.banking.accounts.AccountRepository;
import dev.app.banking.accounts.Amount;
import dev.app.banking.shared.CommandHandler;
import dev.app.banking.shared.DomainException;

public final class InitiateTransferHandler implements CommandHandler<InitiateTransferCommand, TransferId> {

    private final AccountRepository accountRepository;
    private final TransferRepository transferRepository;

    public InitiateTransferHandler(AccountRepository accountRepository, TransferRepository transferRepository) {
        this.accountRepository = accountRepository;
        this.transferRepository = transferRepository;
    }

    @Override
    public TransferId handle(InitiateTransferCommand command) {
        var sourceAccountId = new AccountId(command.sourceAccountId());
        var destinationAccountId = new AccountId(command.destinationAccountId());
        var amount = Amount.of(command.amount());

        var sourceAccount = accountRepository.findById(sourceAccountId)
                .orElseThrow(() -> new DomainException("Source account not found: " + sourceAccountId));

        accountRepository.findById(destinationAccountId)
                .orElseThrow(() -> new DomainException("Destination account not found: " + destinationAccountId));

        var transfer = Transfer.initiate(sourceAccountId, destinationAccountId, amount);

        sourceAccount.withdraw(amount);
        accountRepository.save(sourceAccount);
        transferRepository.save(transfer);

        return transfer.id();
    }
}
