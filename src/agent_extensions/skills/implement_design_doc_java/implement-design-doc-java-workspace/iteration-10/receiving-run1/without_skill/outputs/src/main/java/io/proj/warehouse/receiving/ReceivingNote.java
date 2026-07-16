package io.proj.warehouse.receiving;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

public final class ReceivingNote {

    private final ReceivingNoteId id;
    private final List<ReceivedLine> lines = new ArrayList<>();
    private ReceivingStatus status;
    private final Instant receivedAt;
    private final List<ReceivingEvents> pendingEvents = new ArrayList<>();

    private ReceivingNote(ReceivingNoteId id, Instant receivedAt) {
        this.id = id;
        this.status = ReceivingStatus.OPEN;
        this.receivedAt = receivedAt;
    }

    public static ReceivingNote create() {
        return new ReceivingNote(ReceivingNoteId.generate(), Instant.now());
    }

    public void addLine(Sku sku, Quantity expectedQuantity) {
        if (status.isFinalized()) {
            throw new IllegalStateException("A finalized receiving note cannot be modified");
        }
        if (expectedQuantity.value() < 0) {
            throw new IllegalArgumentException("Received quantity must be non-negative");
        }
        lines.add(new ReceivedLine(sku, expectedQuantity, Quantity.zero()));
    }

    public ReceivingEvents.ReceivingFinalized finalize_() {
        if (status.isFinalized()) {
            throw new IllegalStateException("A finalized receiving note cannot be modified");
        }
        if (lines.isEmpty()) {
            throw new IllegalStateException("A receiving note must have at least one line before it can be finalized");
        }
        this.status = ReceivingStatus.FINALIZED;
        var event = new ReceivingEvents.ReceivingFinalized(id, lines.size(), Instant.now());
        pendingEvents.add(event);
        return event;
    }

    public ReceivingNoteId id() { return id; }
    public List<ReceivedLine> lines() { return List.copyOf(lines); }
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
