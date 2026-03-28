package io.proj.warehouse.receiving;

public final class FinalizeReceivingHandler {

    private final ReceivingNote.Repository repository;

    public FinalizeReceivingHandler(ReceivingNote.Repository repository) {
        this.repository = repository;
    }

    public ReceivingEvents.ReceivingFinalized handle(ReceivingNoteId receivingNoteId) {
        var note = repository.findById(receivingNoteId);
        var event = note.finalize();
        repository.save(note);
        return event;
    }
}
