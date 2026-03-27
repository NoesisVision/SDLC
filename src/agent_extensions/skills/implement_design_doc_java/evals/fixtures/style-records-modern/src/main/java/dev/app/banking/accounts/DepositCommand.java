package dev.app.banking.accounts;

import dev.app.banking.shared.Command;

import java.math.BigDecimal;
import java.util.UUID;

public record DepositCommand(UUID accountId, BigDecimal amount) implements Command<Void> {
}
