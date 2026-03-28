package io.proj.warehouse.receiving;

import io.proj.warehouse.inventory.Quantity;
import io.proj.warehouse.inventory.Sku;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class ReceivingNote {

    private final ReceivingNoteId id;
    private final List<ReceivedLine> lines = new ArrayList<>();
    private ReceivingStatus status;
    private final Instant receivedAt;
    private final List<ReceivingEvents> pendingEvents = new ArrayList<>();

    private ReceivingNote(ReceivingNoteId id, Instant receivedAt) {
        this.id = id;
        this.status = ReceivingStatus.Open;
        this.receivedAt = receivedAt;
    }

    public static ReceivingNote create() {
        return new ReceivingNote(ReceivingNoteId.generate(), Instant.now());
    }

    public void addLine(Sku sku, Quantity expectedQuantity) {
        if (status == ReceivingStatus.Finalized) {
            throw new IllegalStateException("A finalized receiving note cannot be modified");
        }
        lines.add(new ReceivedLine(sku, expectedQuantity, expectedQuantity));
    }

    public void finalize() {
        if (status == ReceivingStatus.Finalized) {
            throw new IllegalStateException("A finalized receiving note cannot be modified");
        }
        if (lines.isEmpty()) {
            throw new IllegalStateException("A receiving note must have at least one line before it can be finalized");
        }
        this.status = ReceivingStatus.Finalized;
        pendingEvents.add(new ReceivingEvents.ReceivingFinalized(id, lines.size(), Instant.now()));
    }

    public ReceivingNoteId id() { return id; }
    public List<ReceivedLine> lines() { return Collections.unmodifiableList(lines); }
    public ReceivingStatus status() { return status; }
    public Instant receivedAt() { return receivedAt; }

    public List<ReceivingEvents> flushEvents() {
        var events = List.copyOf(pendingEvents);
        pendingEvents.clear();
        return events;
    }

    public interface Repository {
        void save(ReceivingNote note);
        ReceivingNote findById(ReceivingNoteId id);
    }
}
