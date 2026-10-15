package org.agentmc.bridge;

import com.google.gson.*;
import java.util.*;

/** One server-owned pick-from-inventory request. No optimistic swap or replay. */
public final class InventoryPick {
    public static final String PROTOCOL = "agent-mc-inventory-pick/v1";
    private JsonObject receipt;
    private List<String> before;
    private final Set<Integer> received = new HashSet<>();
    private int source, selected = -1;
    private long deadline;

    public void begin(String id, int slot, List<String> identities, long now) {
        requireResolved();
        if (slot < 9 || slot > 35 || identities.size() != 41 || identities.get(slot) == null)
            throw new IllegalArgumentException("Pick requires a nonempty standard storage slot 9..35");
        source = slot; before = new ArrayList<>(identities); deadline = now + 5000;
        selected = -1; received.clear(); receipt = new JsonObject();
        receipt.addProperty("protocol", PROTOCOL); receipt.addProperty("id", id);
        receipt.addProperty("actionId", id.substring(0, id.lastIndexOf(':')));
        receipt.addProperty("sourceSlot", source); receipt.addProperty("phase", "running");
        receipt.addProperty("sentAt", now); receipt.addProperty("dispatched", true);
    }
    public boolean unresolved() { return receipt != null && Set.of("running", "unknown").contains(receipt.get("phase").getAsString()); }
    public void requireResolved() {
        if (unresolved()) throw new IllegalStateException("Original inventory request " + receipt.get("id").getAsString()
            + " is unconfirmed; read state/result and await its server response. Do not replay it or start another body action.");
    }
    /** Called only after a server packet was applied on the game thread. */
    public void slot(int syncId, int slot) {
        if (!unresolved()) return;
        int inventorySlot = syncId == -2 ? slot : syncId == 0 ? fromMenu(slot) : -1;
        if (inventorySlot >= 0 && inventorySlot < 41) received.add(inventorySlot);
    }
    public void full(int syncId) { if (unresolved() && syncId == 0) for (int i = 0; i < 41; i++) received.add(i); }
    public void selected(int slot) { if (unresolved() && slot >= 0 && slot < 9) selected = slot; }
    public void update(List<String> actual, int currentSelected, long now) {
        if (!unresolved()) return;
        if (actual.size() != 41) { unknown("Player inventory layout changed"); return; }
        if (selected >= 0 && received.contains(source) && received.contains(selected)) {
            boolean match = currentSelected == selected && Objects.equals(actual.get(selected), before.get(source))
                && Objects.equals(actual.get(source), before.get(selected));
            receipt.addProperty("selectedSlot", selected);
            receipt.addProperty("phase", match ? "completed" : "blocked");
            receipt.addProperty("confirmedAt", now);
            receipt.addProperty("confirmation", "server-slot-and-selection-packets");
            receipt.addProperty("matched", match);
            if (!match) receipt.addProperty("reason", "Server inventory response differs from the requested exchange; inspect fresh inventory");
        } else if (now >= deadline) unknown("Server inventory confirmation timed out; outcome unknown, no replay");
    }
    public void unknown(String reason) {
        if (unresolved() && !receipt.get("phase").getAsString().equals("unknown")) { receipt.addProperty("phase", "unknown"); receipt.addProperty("reason", reason); }
    }
    public JsonObject inspect() { return receipt == null ? new JsonObject() : receipt.deepCopy(); }
    /** Previous connection's unknown receipt remains in its action ledger, never replayed. */
    public void newConnection() { receipt = null; before = null; received.clear(); selected = -1; }
    private static int fromMenu(int slot) { return slot >= 36 && slot <= 44 ? slot - 36 : slot >= 9 && slot <= 35 ? slot : slot >= 5 && slot <= 8 ? 44 - slot : slot == 45 ? 40 : -1; }
}
