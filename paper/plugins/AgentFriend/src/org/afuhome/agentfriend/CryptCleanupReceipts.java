package org.afuhome.agentfriend;

import java.util.*;
import static org.afuhome.agentfriend.CryptTemporaryBlocks.*;

/** Reconciles a journaled reset with an older chunk snapshot after restart. Called on the world thread. */
final class CryptCleanupReceipts {
    record Entry(Cell cell, String original, Set<String> residues, long generation) {
        Entry {
            residues = Set.copyOf(residues);
        }
    }

    /** Each cell's generation must be saved in the same chunk snapshot as the block state. */
    interface Markers {
        /** Null if unavailable, zero if this validated cell has never been marked. */
        Long read(Cell cell);
        void mark(Cell cell, long generation);
    }

    private final UUID world;
    private final Map<Cell,Entry> entries = new LinkedHashMap<>();

    CryptCleanupReceipts(UUID world, List<Entry> rows) {
        this.world = Objects.requireNonNull(world);
        for (Entry row : rows) {
            if (!world.equals(row.cell().world()) || !AIR.contains(row.original())
                    || row.generation() <= 0 || row.residues().isEmpty()
                    || !MATERIALS.containsAll(row.residues()) || entries.putIfAbsent(row.cell(),row) != null)
                throw new IllegalArgumentException("invalid_cleanup_receipt");
        }
    }

    List<Entry> rows() { return List.copyOf(entries.values()); }

    void stage(List<Change> changes, long generation) {
        if (generation <= 0) throw new IllegalArgumentException("invalid_cleanup_generation");
        Map<Cell,Entry> pending = new LinkedHashMap<>();
        for (Change change : changes) {
            Cell cell = change.cell();
            if (!world.equals(cell.world()) || !AIR.contains(change.original()) || !MATERIALS.contains(change.placed())
                    || change.placement() == null || pending.containsKey(cell))
                throw new IllegalArgumentException("invalid_cleanup_change");
            Entry old = entries.get(cell);
            if (old != null && (generation < old.generation() || !old.original().equals(change.original())
                    || generation == old.generation() && !old.residues().contains(change.placed())))
                throw new IllegalArgumentException("conflicting_cleanup_generation_or_baseline");
            Set<String> residues = new HashSet<>(old == null ? Set.of() : old.residues());
            residues.add(change.placed());
            pending.put(cell,new Entry(cell,change.original(),residues,generation));
        }
        entries.putAll(pending);
    }

    boolean forget(Cell cell) { return entries.remove(cell) != null; }

    private record Observed(Entry row, String block) {}

    String recover(List<Change> active, Terrain terrain, Markers markers) {
        Set<Cell> reserved = new HashSet<>();
        for (Change current : active) reserved.add(current.cell());
        List<Observed> pending = new ArrayList<>();
        Set<Cell> supports = new LinkedHashSet<>();
        for (Entry row : rows()) {
            if (reserved.contains(row.cell())) continue;
            Long marker = markers.read(row.cell());
            if (marker == null || marker < 0) return "await_cleanup_marker";
            if (marker >= row.generation()) continue;
            String actual = terrain.read(row.cell());
            if (actual == null) return "await_existing_chunk";
            if (!row.original().equals(actual)) {
                if (!row.residues().contains(actual)) return "block_changed_keep_journal";
                supports.add(row.cell());
            }
            pending.add(new Observed(row,actual));
        }
        // Evacuation can call other plugins. Recheck the whole batch before the first write, then
        // compare the individual image again immediately before touching that cell.
        if (!supports.isEmpty()) {
            if (!terrain.clearOccupants(Set.copyOf(supports))) return "await_safe_exit";
            for (Observed observed : pending) {
                String status = check(observed,terrain,markers);
                if (status != null) return status;
            }
        }
        for (Observed observed : pending) {
            String status = check(observed,terrain,markers);
            if (status != null) return status;
            Entry row = observed.row();
            if (!row.original().equals(observed.block())) {
                terrain.restoreWithoutDrops(row.cell(),row.original());
                if (!row.original().equals(terrain.read(row.cell()))) return "crypt_original_image_unconfirmed";
            }
            markers.mark(row.cell(),row.generation());
        }
        return "ready";
    }

    private String check(Observed observed, Terrain terrain, Markers markers) {
        Entry row = observed.row();
        if (!row.equals(entries.get(row.cell()))) return "cleanup_receipts_changed";
        Long marker = markers.read(row.cell());
        if (marker == null || marker < 0) return "await_cleanup_marker";
        if (marker >= row.generation()) return "cleanup_receipts_changed";
        String actual = terrain.read(row.cell());
        if (actual == null) return "await_existing_chunk";
        return observed.block().equals(actual) ? null : "block_changed_keep_journal";
    }
}
