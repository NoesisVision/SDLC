package dev.app.banking.transfers;

import dev.app.banking.shared.Command;

import java.math.BigDecimal;
import java.util.UUID;

public record InitiateTransferCommand(UUID sourceAccountId, UUID destinationAccountId,
                                      BigDecimal amount) implements Command<TransferId> {
}
