/* SPDX-License-Identifier: MPL-2.0 */
package meow.kikir.freesia.velocity.network.ysm;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** Bounded readback tickets; a late save must never initialize a new mapper. */
public final class WorkerStateRestoreGate {
    public static final int LIMIT = 40, ATTEMPTS = 3;
    private static final long INTERVAL = 5_000_000_000L, TTL = 20_000_000_000L;
    public record Ticket(UUID player, long epoch, Object mapper, Object worker,
                         int entityId, int workerEntityId, int attempt, long expires) {}
    private static final class Slot {
        Ticket ticket;
        int attempts;
        long lastIssued;
        boolean done;
    }
    private final Map<UUID, Slot> slots = new HashMap<>();

    public synchronized Ticket issue(UUID player, long epoch, Object mapper, Object worker,
                                     int entityId, int workerEntityId, long now) {
        if (player == null || mapper == null || worker == null || entityId < 0 || workerEntityId < 0) return null;
        Slot slot = slots.get(player);
        if (slot != null && (slot.ticket.epoch != epoch || slot.ticket.mapper != mapper
                || slot.ticket.worker != worker || slot.ticket.entityId != entityId
                || slot.ticket.workerEntityId != workerEntityId)) slot = null;
        if (slot == null) {
            if (!slots.containsKey(player) && slots.size() >= LIMIT) return null;
            slot = new Slot(); slots.put(player, slot);
        }
        if (slot.done || slot.attempts >= ATTEMPTS
                || (slot.attempts > 0 && now - slot.lastIssued < INTERVAL)) return null;
        slot.lastIssued = now;
        slot.ticket = new Ticket(player, epoch, mapper, worker, entityId, workerEntityId, ++slot.attempts, now + TTL);
        return slot.ticket;
    }

    public synchronized Ticket pending(UUID player, Object worker, long now) {
        Slot slot = slots.get(player);
        return slot != null && !slot.done && slot.ticket.worker == worker && now <= slot.ticket.expires ? slot.ticket : null;
    }

    public synchronized boolean current(Ticket ticket, long epoch, Object mapper, Object worker,
                                        int entityId, int workerEntityId, long now) {
        return ticket != null && pending(ticket.player, worker, now) == ticket
                && ticket.epoch == epoch && ticket.mapper == mapper && ticket.worker == worker
                && ticket.entityId == entityId && ticket.workerEntityId == workerEntityId;
    }

    public synchronized void finish(Ticket ticket) {
        Slot slot = ticket == null ? null : slots.get(ticket.player);
        if (slot != null && slot.ticket == ticket) slot.done = true;
    }
    public synchronized void remove(UUID player) { slots.remove(player); }
}
