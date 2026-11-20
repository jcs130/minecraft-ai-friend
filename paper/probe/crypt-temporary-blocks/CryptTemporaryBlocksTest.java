package org.afuhome.agentfriend;

import com.google.gson.Gson;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import static org.afuhome.agentfriend.CryptTemporaryBlocks.*;

public final class CryptTemporaryBlocksTest {
    static final UUID WORLD = UUID.randomUUID(), RUN = UUID.randomUUID(), NEXT = UUID.randomUUID();
    static final UUID PLAYER = UUID.randomUUID(), OTHER = UUID.randomUUID();
    // Invented fixture cells, independent of any server map.
    static final Cell FIRST = new Cell(WORLD,1,20,1), SECOND = new Cell(WORLD,2,20,1);
    // Fixture choices only. The site operator chooses the enabled safe subset, cap and exit duration.
    static final Rules RULES = new Rules(30 * 60_000L,256,MATERIALS);
    static final Gson JSON = new Gson();
    static final List<String> passed = new ArrayList<>();
    static void test(String name, boolean result) {
        if (!result) throw new AssertionError(name);
        passed.add(name);
    }
    record Saved(long revision, Image image) {}
    static final class Store implements Journal, AutoCloseable {
        final DurableConfigFiles files;
        Saved saved;
        Store(Path path) throws IOException {
            files = new DurableConfigFiles(path);
            byte[] published = Files.exists(path) ? Files.readAllBytes(path)
                    : JSON.toJson(new Saved(0,Image.idle())).getBytes(StandardCharsets.UTF_8);
            long version = JSON.fromJson(new String(published,StandardCharsets.UTF_8),Saved.class).revision;
            saved = JSON.fromJson(new String(files.initialize(published,version),StandardCharsets.UTF_8), Saved.class);
        }
        public Image load() { return saved.image; }
        public void commit(Image next) throws IOException {
            Saved update = new Saved(saved.revision + 1, next);
            files.commit(JSON.toJson(update).getBytes(StandardCharsets.UTF_8), update.revision);
            saved = update;
        }
        public void close() throws IOException { files.close(); }
    }
    record Owner(UUID run, UUID placement) {}
    static final class Ground implements Terrain {
        final Map<Cell,String> actual = new HashMap<>(), durable = new HashMap<>();
        final Map<Cell,Owner> owner = new HashMap<>(), durableOwner = new HashMap<>();
        final Set<UUID> exposed = new HashSet<>();
        boolean safeLanding, loaded = true, failFlush;
        int moves, writes;
        public String read(Cell cell) { return loaded ? actual.get(cell) : null; }
        public boolean ownedBy(Cell cell, UUID run, UUID placement) { return new Owner(run,placement).equals(owner.get(cell)); }
        public boolean clearOccupants(Set<Cell> work) {
            if (!exposed.isEmpty() && !safeLanding) return false;
            moves += exposed.size(); exposed.clear();
            return true;
        }
        public void restoreWithoutDrops(Cell cell, String before) { actual.put(cell,before); owner.remove(cell); writes++; }
        public void flushAndVerify(List<Change> changes) throws IOException {
            if (failFlush) throw new IOException("injected_flush_failure");
            for (Change c : changes) if (!c.original().equals(actual.get(c.cell()))) throw new IOException("verification_mismatch");
            durable.clear(); durable.putAll(actual); durableOwner.clear(); durableOwner.putAll(owner);
        }
        void place(Cell c, String material, UUID placement) {
            actual.put(c,material); owner.put(c,new Owner(RUN,placement)); durable.put(c,material); durableOwner.put(c,owner.get(c));
        }
        void crash() { actual.clear(); actual.putAll(durable); owner.clear(); owner.putAll(durableOwner); }
    }
    static Place p(UUID who, UUID run, Cell cell, String before, String after,
                   boolean area, boolean known, boolean veto, boolean enrolled, boolean single) {
        return new Place(who,run,cell,true,area,known,veto,enrolled,true,single,before,after);
    }
    static Place normal(UUID who, Cell cell, String before, String after, boolean enrolled) {
        return p(who,RUN,cell,before,after,true,true,false,enrolled,true);
    }
    public static void main(String[] args) throws Exception {
        Path directory = Path.of(args[0]);
        Files.createDirectories(directory);
        Path path = directory.resolve("candidate-state.json");
        if (Files.exists(path) || Files.exists(directory.resolve(".state-pending")))
            throw new IllegalArgumentException("Use a new empty fixture directory");
        Ground ground = new Ground();
        ground.actual.put(FIRST,"minecraft:cave_air"); ground.actual.put(SECOND,"minecraft:air");
        UUID first = UUID.randomUUID(), second = UUID.randomUUID();
        Place block = normal(PLAYER,FIRST,"minecraft:cave_air","minecraft:netherrack",true);
        Place table = normal(PLAYER,SECOND,"minecraft:air","minecraft:crafting_table",false);
        try (Store db = new Store(path)) {
            CryptTemporaryBlocks c = new CryptTemporaryBlocks(WORLD,RULES,db);
            c.begin(RUN);
            test("same-site second party cannot open a parallel round",c.resetBeforeAdmission(ground).equals("site_busy"));
            test("single-cell read-only query changes neither journal nor terrain",c.inspect(block,"place",0) == Decision.ALLOWED && db.saved.revision == 1 && ground.writes == 0);
            test("participant may not break a temporary or original block",c.inspect(block,"break",0) == Decision.WRONG_ACTION);
            test("unknown generated overlap stays closed",c.inspect(p(PLAYER,RUN,FIRST,"minecraft:air","minecraft:stone",true,false,false,true,true),"place",0)==Decision.REGION_UNCONFIRMED);
            test("separate protection veto survives the site exception",c.inspect(p(PLAYER,RUN,FIRST,"minecraft:air","minecraft:stone",true,true,true,true,true),"place",0)==Decision.OTHER_PROTECTION);
            test("outside surveyed region remains closed",c.inspect(p(PLAYER,RUN,FIRST,"minecraft:air","minecraft:stone",false,true,false,true,true),"place",0)==Decision.WRONG_SITE);
            test("other people receive no construction rights",c.inspect(normal(OTHER,FIRST,"minecraft:air","minecraft:stone",false),"place",0)==Decision.NO_LEASE);
            test("container, gravity, liquid, TNT and redstone denied",List.of("chest","sand","water","tnt","piston").stream().allMatch(n->c.inspect(normal(PLAYER,FIRST,"minecraft:air","minecraft:"+n,true),"place",0)==Decision.WRONG_MATERIAL));
            test("original geometry, tile blocks and multiblock edits are untouched",c.inspect(normal(PLAYER,FIRST,"minecraft:chest","minecraft:stone",true),"place",0)==Decision.OCCUPIED_CELL && c.inspect(p(PLAYER,RUN,FIRST,"minecraft:air","minecraft:stone",true,true,false,true,false),"place",0)==Decision.WRONG_ACTION);
            test("first support reservation durably precedes native placement",c.reserve(block,first,0)==Decision.ALLOWED && db.load().changes().size()==1);
            Rules small = new Rules(60_000,1,Set.of("minecraft:netherrack"));
            CryptTemporaryBlocks alternativeRules = new CryptTemporaryBlocks(WORLD,small,db);
            test("operator-configured cell budget and material selection apply to new edits",alternativeRules.inspect(normal(PLAYER,SECOND,"minecraft:air","minecraft:netherrack",true),"place",0)==Decision.LIMIT
                    && alternativeRules.inspect(normal(PLAYER,SECOND,"minecraft:air","minecraft:crafting_table",true),"place",0)==Decision.WRONG_MATERIAL);
            ground.place(FIRST,block.placed(),first);
            c.finish(RUN,Set.of(PLAYER,OTHER),1000);
            c.left(OTHER);
            test("leaving then returning cannot revive a paid-out player's authority",c.inspect(normal(OTHER,SECOND,"minecraft:air","minecraft:stone",false),"place",2000)==Decision.NO_LEASE);
            test("standing last-round participant may place a workbench during the exit window",c.reserve(table,second,1000+RULES.exitMillis()/2)==Decision.ALLOWED);
            ground.place(SECOND,table.placed(),second);
            c.cancelled(RUN,SECOND,UUID.randomUUID());
            test("a stale cancellation cannot discard the newer cell record",db.load().changes().size()==2);
            test("even a continuously present player has a bounded exit window",c.inspect(table,"place",1000+RULES.exitMillis())==Decision.NO_LEASE);
        }
        try (Store db = new Store(path)) {
            CryptTemporaryBlocks c = new CryptTemporaryBlocks(WORLD,RULES,db);
            test("process restart loads durable block records but grants no historic exit access",db.load().changes().size()==2 && c.inspect(table,"place",1100)==Decision.NO_LEASE);
            test("unknown server run checkpoint cannot authorize recovery",c.afterRunRestore(false,null).equals("await_run_checkpoint"));
            ground.loaded=false;
            test("missing chunk blocks admission and revokes old lease",c.resetBeforeAdmission(ground).equals("await_existing_chunk") && c.image().phase()==Phase.RESET && ground.writes==0);
            ground.loaded=true;
            ground.exposed.add(PLAYER); ground.exposed.add(OTHER);
            test("players above supports remain standing when entry landing is unavailable",c.resetBeforeAdmission(ground).equals("await_safe_exit") && ground.writes==0 && ground.exposed.size()==2);
            ground.owner.remove(FIRST);
            test("another editor's identical material cannot be erased by the old run",c.resetBeforeAdmission(ground).equals("ownership_changed_keep_journal") && ground.writes==0);
            ground.owner.put(FIRST,new Owner(RUN,first)); ground.actual.put(SECOND,"minecraft:barrel");
            test("conflicting third image blocks all physical work",c.resetBeforeAdmission(ground).equals("block_changed_keep_journal") && ground.writes==0);
            ground.actual.put(SECOND,"minecraft:crafting_table"); ground.safeLanding=true; ground.failFlush=true;
            boolean failed=false;
            try { c.resetBeforeAdmission(ground); } catch (IOException expected) { failed=true; }
            test("verified safe exit moves old team and bystander before restoring either support",ground.moves==2 && ground.exposed.isEmpty() && ground.writes==2);
            test("failed terrain flush keeps both exact original images and admission closed",failed && db.load().phase()==Phase.RESET && db.load().changes().size()==2);
        }
        ground.crash(); ground.failFlush=false;
        try (Store db = new Store(path)) {
            CryptTemporaryBlocks c = new CryptTemporaryBlocks(WORLD,RULES,db);
            test("restarted reset replays only the recorded cells with the original air variants",c.resetBeforeAdmission(ground).equals("ready") && "minecraft:cave_air".equals(ground.durable.get(FIRST)) && "minecraft:air".equals(ground.durable.get(SECOND)));
            test("completed cleanup is idempotent",c.resetBeforeAdmission(ground).equals("ready") && ground.writes==4);
            c.begin(NEXT);
            test("next round cannot inherit old team's lease",!c.image().run().equals(RUN) && c.inspect(block,"place",1000)==Decision.NO_LEASE);
            test("restored active round must match the canonical dungeon run",c.afterRunRestore(true,NEXT).equals("active") && c.afterRunRestore(true,RUN).equals("different_checkpoint"));
            test("orphaned active journal requires cleanup before new admission",c.afterRunRestore(true,null).equals("cleanup_pending") && c.image().phase()==Phase.RESET);
        }
        passed.addAll(CryptCleanupReceiptsTest.run());
        System.out.println(JSON.toJson(Map.of("passed",passed,"count",passed.size(),"journal","AgentFriend DurableConfigFiles","terrain","synthetic","actualServerConnected",false)));
    }
}
