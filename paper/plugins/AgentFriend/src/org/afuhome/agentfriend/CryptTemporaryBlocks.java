package org.afuhome.agentfriend;

import java.util.*;

/** Per-round reserved cells in one configured site. Server callbacks supply live protection, player and terrain facts. */
final class CryptTemporaryBlocks {
    static final String SITE = "undead_crypt";
    static final Set<String> MATERIALS = Set.of("minecraft:cobblestone", "minecraft:stone", "minecraft:netherrack",
            "minecraft:dirt", "minecraft:cobbled_deepslate", "minecraft:oak_planks", "minecraft:crafting_table");
    static final Set<String> AIR = Set.of("minecraft:air", "minecraft:cave_air", "minecraft:void_air");
    record Rules(long exitMillis, int maximumCells, Set<String> materials) {
        Rules {
            materials = Set.copyOf(materials);
            if (exitMillis <= 0 || maximumCells <= 0 || materials.isEmpty() || !MATERIALS.containsAll(materials))
                throw new IllegalArgumentException("invalid_temporary_rules");
        }
    }

    record Cell(UUID world, int x, int y, int z) {}
    record Change(Cell cell, String original, String placed, UUID placement) {}
    enum Phase { IDLE, ACTIVE, EXIT, RESET }
    record Image(UUID run, Phase phase, List<Change> changes, Set<Cell> released) {
        Image { changes = List.copyOf(changes); released = released==null?Set.of():Set.copyOf(released); }
        Image(UUID run, Phase phase, List<Change> changes) { this(run,phase,changes,Set.of()); }
        static Image idle() { return new Image(null, Phase.IDLE, List.of()); }
    }
    enum Decision { ALLOWED, WRONG_SITE, REGION_UNCONFIRMED, OTHER_PROTECTION, NO_LEASE,
        WRONG_ACTION, WRONG_MATERIAL, OCCUPIED_CELL, LIMIT, RESET_PENDING }

    // allProtectionKnown includes the native generated-structure pieces for this very block.
    // otherVeto includes any independent protection beyond this configured site and its paired structure.
    record Place(UUID player, UUID run, Cell cell, boolean sameSite, boolean inTemporaryZone,
                 boolean allProtectionKnown, boolean otherVeto, boolean enrolledHere,
                 boolean presentInSite, boolean singleBlock, String original, String placed) {}
    interface Journal {
        Image load();
        void commit(Image image) throws Exception;
    }
    interface Terrain {
        /** Return null for unavailable worlds/chunks. Never generate chunks for recovery. */
        String read(Cell cell);
        /** Membership of this recorded cell in the round reservation. Administrative takeover first releases it. */
        boolean ownedBy(Cell cell, UUID run, UUID placement);
        /** Move every exposed occupant, including bystanders, to a verified landing outside the affected column.
         * Return true only after verifying that the entire work set is safe to change on this server tick. */
        boolean clearOccupants(Set<Cell> work);
        void restoreWithoutDrops(Cell cell, String exactBefore);
        /** Succeed only after all touched chunks durably contain the checked original images. */
        void flushAndVerify(List<Change> changes) throws Exception;
    }
    private final UUID world;
    private final Rules rules;
    private final Journal journal;
    private Image image;
    // Exit permission is never derived from persistent rewards, attendance, or a logged-out UUID.
    private Set<UUID> remaining = new HashSet<>();
    private long exitUntil;

    CryptTemporaryBlocks(UUID world, Rules rules, Journal journal) {
        this.world = Objects.requireNonNull(world);
        this.rules = Objects.requireNonNull(rules);
        this.journal = journal;
        image = journal.load();
        if (image == null || image.phase == null || (image.phase == Phase.IDLE) != (image.run == null)
                || image.phase == Phase.IDLE && (!image.changes.isEmpty()||!image.released.isEmpty()))
            throw new IllegalStateException("invalid_site_journal");
        Set<Cell> seen = new HashSet<>();
        for (Change row : image.changes)
            if (!world.equals(row.cell.world) || !seen.add(row.cell) || row.placement == null || !AIR.contains(row.original) || !MATERIALS.contains(row.placed))
                throw new IllegalStateException("invalid_cell_journal");
        if(image.released.stream().anyMatch(c->!world.equals(c.world)||seen.contains(c)))throw new IllegalStateException("invalid_released_cell");
    }
    Image image() { return image; }
    private void save(Image next) throws Exception { journal.commit(next); image = next; }
    void begin(UUID newRun) throws Exception {
        if (image.phase != Phase.IDLE) throw new IllegalStateException("prior_round_not_clean");
        save(new Image(Objects.requireNonNull(newRun), Phase.ACTIVE, List.of()));
    }
    /** Reconcile only after the authoritative dungeon checkpoint loader has finished. */
    String afterRunRestore(boolean loaded, UUID activeRun) throws Exception {
        if (!loaded) return "await_run_checkpoint";
        if (activeRun != null && image.phase == Phase.IDLE) return "unmanaged_active_round";
        if (activeRun != null)
            return image.phase == Phase.ACTIVE && activeRun.equals(image.run) ? "active" : "different_checkpoint";
        if (image.phase == Phase.ACTIVE) save(new Image(image.run, Phase.RESET, image.changes,image.released));
        return image.phase == Phase.IDLE ? "ready" : "cleanup_pending";
    }
    void finish(UUID run, Set<UUID> survivingMembersStillHere, long now) throws Exception {
        if (image.phase != Phase.ACTIVE || !image.run.equals(run)) throw new IllegalStateException("wrong_active_round");
        save(new Image(run, Phase.EXIT, image.changes,image.released));
        remaining = new HashSet<>(survivingMembersStillHere);
        exitUntil = Math.addExact(now,rules.exitMillis);
    }
    /** Call after actual boundary crossing, quit, realm change or death. Reentry never creates an exit lease. */
    void left(UUID player) { remaining.remove(player); }
    boolean tracksExit(UUID player) { return remaining.contains(player); }
    Decision inspect(Place p, String action, long now) {
        if (!world.equals(p.cell.world) || !p.sameSite || !p.inTemporaryZone) return Decision.WRONG_SITE;
        if (!action.equals("place") || !p.singleBlock) return Decision.WRONG_ACTION;
        if (!p.allProtectionKnown) return Decision.REGION_UNCONFIRMED;
        if (p.otherVeto) return Decision.OTHER_PROTECTION;
        if (image.phase == Phase.RESET) return Decision.RESET_PENDING;
        if (image.run == null || !image.run.equals(p.run) || !p.presentInSite) return Decision.NO_LEASE;
        boolean allowed = image.phase == Phase.ACTIVE && p.enrolledHere
                || image.phase == Phase.EXIT && now < exitUntil && remaining.contains(p.player);
        if (!allowed) return Decision.NO_LEASE;
        if (!rules.materials.contains(p.placed)) return Decision.WRONG_MATERIAL;
        if (!AIR.contains(p.original) || image.changes.stream().anyMatch(c -> c.cell.equals(p.cell))) return Decision.OCCUPIED_CELL;
        if (image.released.contains(p.cell)) return Decision.WRONG_SITE;
        if (image.changes.size() >= rules.maximumCells) return Decision.LIMIT;
        return Decision.ALLOWED;
    }
    /** Normal survival placement and inventory charging remain in the server. When a later listener cancels,
     * the reservation reads its original image at restore. Never manufacture a second placement or item. */
    Decision reserve(Place p, UUID placement, long now) throws Exception {
        Decision decision = inspect(p, "place", now);
        if (decision != Decision.ALLOWED) return decision;
        List<Change> next = new ArrayList<>(image.changes);
        next.add(new Change(p.cell, p.original, p.placed, Objects.requireNonNull(placement)));
        save(new Image(image.run, image.phase, next,image.released));
        return decision;
    }
    void cancelled(UUID run, Cell cell, UUID placement) throws Exception {
        if (!Objects.equals(run, image.run) || image.phase == Phase.RESET) return;
        List<Change> keep = image.changes.stream().filter(c -> !c.cell.equals(cell) || !c.placement.equals(placement)).toList();
        if (keep.size() != image.changes.size()) save(new Image(image.run, image.phase, keep,image.released));
    }
    boolean relinquish(Cell cell) throws Exception {
        List<Change> keep = image.changes.stream().filter(c -> !c.cell.equals(cell)).toList();
        if (keep.size() == image.changes.size()) return false;
        Set<Cell> released=new HashSet<>(image.released);
        released.add(cell);
        save(new Image(image.run,image.phase,keep,released));
        return true;
    }
    String resetBeforeAdmission(Terrain terrain) throws Exception {
        if (image.phase == Phase.ACTIVE) return "site_busy";
        if (image.phase == Phase.IDLE) return "ready";
        if (image.phase != Phase.RESET) save(new Image(image.run, Phase.RESET, image.changes,image.released));
        remaining.clear();
        Set<Cell> touched = new LinkedHashSet<>();
        for (Change row : image.changes) {
            String actual = terrain.read(row.cell);
            if (actual == null) return "await_existing_chunk";
            if (!row.original.equals(actual) && !row.placed.equals(actual)) return "block_changed_keep_journal";
            if (row.placed.equals(actual)) {
                if (!terrain.ownedBy(row.cell, image.run, row.placement)) return "ownership_changed_keep_journal";
                touched.add(row.cell);
            }
        }
        if (!touched.isEmpty() && !terrain.clearOccupants(Set.copyOf(touched))) return "await_safe_exit";
        for (Change row : image.changes) {
            String actual = terrain.read(row.cell);
            if (row.original.equals(actual)) continue;
            if (!row.placed.equals(actual)) return "block_changed_keep_journal";
            if (!terrain.ownedBy(row.cell, image.run, row.placement)) return "ownership_changed_keep_journal";
            terrain.restoreWithoutDrops(row.cell, row.original);
        }
        terrain.flushAndVerify(image.changes);
        save(Image.idle());
        return "ready";
    }
}
