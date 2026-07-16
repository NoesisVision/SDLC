package dev.app.banking.transfers;

import java.util.Optional;

public interface TransferRepository {
    void save(Transfer transfer);
    Optional<Transfer> findById(TransferId id);
}
