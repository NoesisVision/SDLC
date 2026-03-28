package io.proj.warehouse.receiving;

public record ReceivingStatus(String value) {
    public static final ReceivingStatus OPEN = new ReceivingStatus("Open");
    public static final ReceivingStatus FINALIZED = new ReceivingStatus("Finalized");

    public boolean isFinalized() { return FINALIZED.equals(this); }
}
