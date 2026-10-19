package org.afuhome.numen;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** Main-thread, one-use responses. Reopening or quitting invalidates old UI. */
final class FormTickets {
    private record Ticket(UUID id, long expires) {}
    private final Map<UUID, Ticket> open = new HashMap<>();
    UUID issue(UUID owner, long now) {
        UUID id = UUID.randomUUID(); open.put(owner, new Ticket(id, now + 300_000)); return id;
    }
    boolean take(UUID owner, UUID id, long now) {
        Ticket ticket = open.get(owner);
        if (ticket == null || !ticket.id.equals(id)) return false;
        open.remove(owner);
        return now <= ticket.expires;
    }
    void close(UUID owner) { open.remove(owner); }
    void clear() { open.clear(); }
}
