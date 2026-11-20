package org.afuhome.agentfriend;

import com.google.gson.Gson;
import java.util.*;
import static org.afuhome.agentfriend.CryptTemporaryBlocks.*;
import static org.afuhome.agentfriend.CryptCleanupReceipts.Entry;

public final class CryptCleanupReceiptsTest {
    private static final UUID WORLD = UUID.randomUUID();
    // Deliberately invented cells in the same synthetic chunk.
    private static final Cell A = new Cell(WORLD,1,20,1), B = new Cell(WORLD,2,20,1);
    private static final String CAVE = "minecraft:cave_air", AIR_BLOCK = "minecraft:air";
    private static final String STONE = "minecraft:stone", TABLE = "minecraft:crafting_table";
    private static Change change(Cell cell, String before, String after) {
        return new Change(cell,before,after,UUID.randomUUID());
    }
    private static final Change FIRST = change(A,CAVE,STONE), SECOND = change(B,AIR_BLOCK,TABLE);

    private static final class Chunk implements Terrain {
        final Map<Cell,String> blocks = new HashMap<>();
        final Map<Cell,Long> watermarks = new HashMap<>();
        Set<Cell> cleared = Set.of();
        Runnable onEvacuation = () -> {};
        boolean safe = true;
        int writes, marks;
        void put(Change change) { blocks.put(change.cell(),change.placed()); }
        public String read(Cell c) { return blocks.get(c); }
        public boolean ownedBy(Cell c, UUID run, UUID placement) { throw new AssertionError("No live run in cold recovery"); }
        public void restoreWithoutDrops(Cell c, String original) { writes++; blocks.put(c,original); }
        public boolean clearOccupants(Set<Cell> cells) { cleared = cells; onEvacuation.run(); return safe; }
        public void flushAndVerify(List<Change> changes) { throw new AssertionError("Cold recovery must not force a world save"); }

        // Markers and block state share this synthetic chunk but have distinct read signatures.
        final CryptCleanupReceipts.Markers markers = new CryptCleanupReceipts.Markers() {
            public Long read(Cell cell) { return watermarks.getOrDefault(cell,0L); }
            public void mark(Cell cell, long generation) {
                marks++;
                watermarks.put(cell,generation);
            }
        };
    }

    private static CryptCleanupReceipts load(Change... changes) {
        var receipts = new CryptCleanupReceipts(WORLD,List.of());
        receipts.stage(List.of(changes),4);
        Gson gson = new Gson();
        Entry[] rows = gson.fromJson(gson.toJson(receipts.rows()),Entry[].class);
        return new CryptCleanupReceipts(WORLD,List.of(rows));
    }

    private static void check(List<String> passed, String name, boolean result) {
        if (!result) throw new AssertionError(name);
        passed.add(name);
    }
    private static boolean rejected(Runnable action) {
        try { action.run(); return false; }
        catch (IllegalArgumentException expected) { return true; }
    }

    static List<String> run() {
        List<String> passed = new ArrayList<>();
        var receipts = load(FIRST,SECOND);
        var cold = new Chunk();
        cold.put(FIRST); cold.blocks.put(B,AIR_BLOCK);
        check(passed,"cold chunk restores only residual blocks and certifies their exact air images",
                receipts.recover(List.of(),cold,cold.markers).equals("ready")
                && cold.writes == 1 && cold.marks == 2 && cold.cleared.equals(Set.of(A))
                && CAVE.equals(cold.blocks.get(A)) && cold.watermarks.equals(Map.of(A,4L,B,4L)));
        cold.put(FIRST);
        check(passed,"certified cell keeps identical material later placed by another editor",
                receipts.recover(List.of(),cold,cold.markers).equals("ready") && cold.writes == 1 && cold.marks == 2
                && STONE.equals(cold.blocks.get(A)));

        var occupied = new Chunk();
        occupied.put(FIRST); occupied.put(SECOND);
        check(passed,"new round owns an active cell while its neighboring stale cell can recover",
                receipts.recover(List.of(FIRST),occupied,occupied.markers).equals("ready")
                && STONE.equals(occupied.blocks.get(A)) && occupied.watermarks.equals(Map.of(B,4L)));
        var conflict = new Chunk();
        conflict.put(FIRST); conflict.blocks.put(B,"minecraft:barrel");
        check(passed,"third image anywhere prevents all writes and markers",
                receipts.recover(List.of(),conflict,conflict.markers).equals("block_changed_keep_journal")
                && conflict.writes == 0 && conflict.marks == 0 && conflict.cleared.isEmpty());
        conflict.blocks.put(B,"minecraft:void_air");
        check(passed,"a different air variant is also an unowned third image",
                receipts.recover(List.of(),conflict,conflict.markers).equals("block_changed_keep_journal")
                && conflict.writes == 0 && conflict.marks == 0);
        conflict.blocks.remove(B);
        check(passed,"missing terrain defers the entire batch",
                receipts.recover(List.of(),conflict,conflict.markers).equals("await_existing_chunk")
                && conflict.writes == 0 && conflict.marks == 0);
        conflict.put(SECOND); conflict.watermarks.put(B,null);
        check(passed,"unknown generation cannot be treated as never marked",
                receipts.recover(List.of(),conflict,conflict.markers).equals("await_cleanup_marker")
                && conflict.writes == 0 && conflict.marks == 0);
        conflict.watermarks.clear(); conflict.safe = false;
        check(passed,"a blocked exit preserves both supports and generations",
                receipts.recover(List.of(),conflict,conflict.markers).equals("await_safe_exit")
                && conflict.writes == 0 && conflict.marks == 0 && conflict.cleared.equals(Set.of(A,B)));
        conflict.safe = true; conflict.onEvacuation = () -> conflict.blocks.put(B,"minecraft:barrel");
        check(passed,"a changed image during evacuation prevents writing even the first cell",
                receipts.recover(List.of(),conflict,conflict.markers).equals("block_changed_keep_journal")
                && conflict.writes == 0 && conflict.marks == 0);

        var taken = load(FIRST);
        var handed = new Chunk(); handed.put(FIRST);
        handed.onEvacuation = () -> taken.forget(A);
        check(passed,"administrative handover during evacuation cancels pending compensation",
                taken.recover(List.of(),handed,handed.markers).equals("cleanup_receipts_changed")
                && handed.writes == 0 && handed.marks == 0);
        check(passed,"forgotten cell stays outside cold recovery after restart",
                new CryptCleanupReceipts(WORLD,taken.rows()).recover(List.of(),handed,handed.markers).equals("ready")
                && handed.writes == 0 && handed.marks == 0 && !taken.forget(A));

        var multiple = load(FIRST);
        Change newer = change(A,CAVE,TABLE);
        multiple.stage(List.of(newer),7); multiple.stage(List.of(newer),7);
        var merged = multiple.rows().getFirst();
        check(passed,"multiple rounds merge residues and retain one exact original per cell",
                multiple.rows().size() == 1 && merged.original().equals(CAVE)
                && merged.residues().equals(Set.of(STONE,TABLE)) && merged.generation() == 7);
        var rewind = new Chunk(); rewind.put(FIRST); rewind.watermarks.put(A,4L);
        check(passed,"older snapshot and generation can miss several consecutive resets",
                multiple.recover(List.of(),rewind,rewind.markers).equals("ready")
                && rewind.blocks.get(A).equals(CAVE) && rewind.watermarks.get(A) == 7L);
        rewind.put(newer); rewind.watermarks.put(A,8L);
        check(passed,"a later generation preserves the world's current cell",
                multiple.recover(List.of(),rewind,rewind.markers).equals("ready")
                && rewind.blocks.get(A).equals(TABLE) && rewind.watermarks.get(A) == 8L && rewind.writes == 1);
        List<Entry> previous = multiple.rows();
        check(passed,"regressive and conflicting staged batches leave every previous row intact",
                rejected(() -> multiple.stage(List.of(SECOND,newer),6))
                && rejected(() -> multiple.stage(List.of(change(A,AIR_BLOCK,TABLE)),8))
                && multiple.rows().equals(previous));
        var foreign = new Cell(UUID.randomUUID(),1,20,1);
        check(passed,"serialized receipts validate origin, world, unique cell, residue and generation",
                rejected(() -> new CryptCleanupReceipts(WORLD,List.of(merged,merged)))
                && rejected(() -> new CryptCleanupReceipts(WORLD,List.of(new Entry(foreign,CAVE,Set.of(STONE),1))))
                && rejected(() -> new CryptCleanupReceipts(WORLD,List.of(new Entry(A,STONE,Set.of(STONE),1))))
                && rejected(() -> new CryptCleanupReceipts(WORLD,List.of(new Entry(A,CAVE,Set.of("minecraft:barrel"),1))))
                && rejected(() -> new CryptCleanupReceipts(WORLD,List.of(new Entry(A,CAVE,Set.of(),1))))
                && rejected(() -> new CryptCleanupReceipts(WORLD,List.of(new Entry(A,CAVE,Set.of(STONE),0)))));
        return passed;
    }
}
