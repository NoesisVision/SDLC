package dev.app.banking.accounts;

import dev.app.banking.shared.Command;

import java.math.BigDecimal;

public record OpenAccountCommand(BigDecimal initialDeposit) implements Command<AccountId> {
}
