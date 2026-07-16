package dev.app.banking.transfers;

import dev.app.banking.accounts.AccountId;
import dev.app.banking.accounts.Amount;
import dev.app.banking.shared.CommandHandler;

public final class InitiateTransferHandler implements CommandHandler<InitiateTransferCommand, TransferId> {

    private final TransferRepository transferRepository;

    public InitiateTransferHandler(TransferRepository transferRepository) {
        this.transferRepository = transferRepository;
    }

    @Override
    public TransferId handle(InitiateTransferCommand command) {
        var sourceAccountId = new AccountId(command.sourceAccountId());
        var destinationAccountId = new AccountId(command.destinationAccountId());
        var amount = Amount.of(command.amount());
        var transfer = Transfer.initiate(sourceAccountId, destinationAccountId, amount);
        transferRepository.save(transfer);
        return transfer.id();
    }
}
