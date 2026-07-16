package io.proj.warehouse.receiving;

public final class FinalizeReceivingHandler {

    private final ReceivingNote.Repository repository;

    public FinalizeReceivingHandler(ReceivingNote.Repository repository) {
        this.repository = repository;
    }

    public ReceivingEvents.ReceivingFinalized handle(ReceivingNoteId receivingNoteId) {
        var note = repository.findById(receivingNoteId);
        note.finalize();
        repository.save(note);
        var events = note.flushEvents();
        return events.stream()
                .filter(e -> e instanceof ReceivingEvents.ReceivingFinalized)
                .map(e -> (ReceivingEvents.ReceivingFinalized) e)
                .findFirst()
                .orElseThrow();
    }
}
