package dev.app.banking.transfers;

import dev.app.banking.accounts.AccountId;
import dev.app.banking.accounts.AccountRepository;
import dev.app.banking.accounts.Amount;
import dev.app.banking.shared.CommandHandler;
import dev.app.banking.shared.DomainException;

public final class InitiateTransferHandler implements CommandHandler<InitiateTransferCommand, TransferId> {

    private final TransferRepository transferRepository;
    private final AccountRepository accountRepository;

    public InitiateTransferHandler(TransferRepository transferRepository, AccountRepository accountRepository) {
        this.transferRepository = transferRepository;
        this.accountRepository = accountRepository;
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
