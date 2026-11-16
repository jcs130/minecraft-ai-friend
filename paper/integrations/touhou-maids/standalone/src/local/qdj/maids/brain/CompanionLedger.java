package local.qdj.maids.brain;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/** Durable reservations, independent of entity loading and of the selected LLM. Server-thread only. */
final class CompanionLedger {
    record Point(String dimension, int x, int y, int z) {}
    record Home(Point work, Point idle, Point sleep, boolean configured, String schedule, String task) {}
    record Event(long at, UUID player, String action) {}
    record Entry(UUID maid, UUID leader, UUID contract, String mode, Home home, Point work,
                 long joinedAt, long expiresAt, long disconnectedAt, long revision, int trips, List<Event> history) {
        Entry change(UUID nextLeader, String nextMode, Point nextWork, long disconnected, long now, String action) {
            var events = new ArrayList<>(history);
            if (action != null) events.add(new Event(now, leader == null ? nextLeader : leader, action));
            while (events.size() > 32) events.removeFirst();
            return new Entry(maid, nextLeader, contract, nextMode, home, nextWork, joinedAt, expiresAt,
                    disconnected, revision + 1, trips, List.copyOf(events));
        }
    }
    private record Data(int schema, List<Entry> companions) {}
    private static final Gson JSON = new GsonBuilder().setPrettyPrinting().create();
    private final Path file;
    private Map<UUID, Entry> rows = new LinkedHashMap<>();

    CompanionLedger(Path file) throws IOException {
        this.file = file;
        if (!Files.exists(file)) return;
        if (Files.size(file) > 1024 * 1024) throw new IOException("companion_ledger_too_large");
        try {
            Data data = JSON.fromJson(Files.readString(file, StandardCharsets.UTF_8), Data.class);
            if (data == null || data.schema != 1 || data.companions == null || data.companions.size() > 64)
                throw new IllegalArgumentException("invalid_companion_ledger");
            for (Entry entry : data.companions) {
                validate(entry);
                if (rows.putIfAbsent(entry.maid, entry) != null)
                    throw new IllegalArgumentException("duplicate_companion_reservation");
            }
            validateParties(rows);
        } catch (RuntimeException bad) { throw new IOException("invalid_companion_ledger", bad); }
    }

    Entry get(UUID maid) { return rows.get(maid); }
    List<Entry> entries() { return List.copyOf(rows.values()); }
    List<Entry> party(UUID leader) { return rows.values().stream().filter(e -> leader.equals(e.leader)).toList(); }

    Entry recruit(UUID maid, UUID leader, Home home, Point work, long now, long duration) throws IOException {
        Entry previous = get(maid);
        if (previous != null && leader.equals(previous.leader)) return previous;
        if (previous != null && !previous.mode.equals("available")) throw new IllegalArgumentException("companion_busy");
        if (maid.equals(leader)) throw new IllegalArgumentException("cannot_follow_self");
        if (!party(maid).isEmpty() || get(leader) != null && get(leader).leader != null)
            throw new IllegalArgumentException("nested_party_not_supported");
        List<Event> events = previous == null ? List.of() : previous.history;
        Entry next = new Entry(maid, leader, UUID.randomUUID(), "follow", home, work, now,
                Math.addExact(now, duration), 0, previous == null ? 0 : previous.revision,
                previous == null ? 0 : previous.trips, events).change(leader, "follow", work, 0, now, "recruit");
        put(next);
        return next;
    }

    Entry order(UUID maid, UUID leader, UUID expectedContract, String mode, Point work, long now) throws IOException {
        Entry old = require(maid, leader, expectedContract);
        if (!List.of("follow", "stay", "work").contains(mode)) throw new IllegalArgumentException("invalid_order");
        Entry next = old.change(leader, mode, work, 0, now, mode);
        put(next);
        return next;
    }

    Entry require(UUID maid, UUID leader, UUID expectedContract) {
        Entry old = get(maid);
        if (old == null || !leader.equals(old.leader)) throw new IllegalArgumentException("not_your_companion");
        if (expectedContract != null && !Objects.equals(expectedContract, old.contract))
            throw new IllegalArgumentException("stale_contract");
        return old;
    }

    void put(Entry entry) throws IOException {
        validate(entry);
        var next = new LinkedHashMap<>(rows);
        next.put(entry.maid, entry);
        validateParties(next);
        if (next.size() > 64) throw new IOException("companion_ledger_full");
        byte[] bytes = JSON.toJson(new Data(1, List.copyOf(next.values()))).getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 1024 * 1024) throw new IOException("companion_ledger_too_large");
        Files.createDirectories(file.getParent());
        Path temp = Files.createTempFile(file.getParent(), "companion-", ".tmp");
        try {
            try (var channel = FileChannel.open(temp, StandardOpenOption.WRITE)) {
                var buffer = ByteBuffer.wrap(bytes);
                while (buffer.hasRemaining()) channel.write(buffer);
                channel.force(true);
            }
            // An unsupported atomic replace is a failure, never a successful in-memory-only reservation.
            Files.move(temp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            rows = next;
        } finally { Files.deleteIfExists(temp); }
    }

    private static void validate(Entry e) {
        if (e == null || e.maid == null || e.contract == null || e.home == null || e.work == null ||
                e.home.work == null || e.home.idle == null || e.home.sleep == null ||
                e.home.task == null || e.home.schedule == null || e.history == null || e.history.size() > 32 ||
                e.joinedAt < 0 || e.expiresAt < e.joinedAt || e.disconnectedAt < 0 || e.revision < 0 || e.trips < 0 ||
                !List.of("follow", "stay", "work", "returning", "available", "dead", "paused").contains(e.mode) ||
                (!e.mode.equals("paused")&&(List.of("follow", "stay", "work").contains(e.mode) != (e.leader != null))))
            throw new IllegalArgumentException("invalid_companion_entry");
        for (Point p : List.of(e.work, e.home.work, e.home.idle, e.home.sleep)) {
            if (p.dimension == null || !p.dimension.matches("[a-z0-9_.-]+:[a-z0-9/._-]+") ||
                    Math.abs((long)p.x) > 30_000_000 || Math.abs((long)p.z) > 30_000_000 || Math.abs((long)p.y) > 4096)
                throw new IllegalArgumentException("invalid_companion_position");
        }
        for (Event event : e.history) if (event == null || event.at < 0 || event.action == null ||
                !event.action.matches("[a-z_]{1,40}")) throw new IllegalArgumentException("invalid_companion_history");
    }

    private static void validateParties(Map<UUID,Entry> rows) {
        for (Entry e : rows.values()) if (e.leader != null) {
            Entry leader = rows.get(e.leader);
            if (e.maid.equals(e.leader) || leader != null && leader.leader != null)
                throw new IllegalArgumentException("nested_party_not_supported");
        }
    }
}
