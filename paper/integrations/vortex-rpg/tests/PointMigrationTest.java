package org.qiandengji.vortex;

import com.google.gson.*;
import io.vortexcore.VortexCorePlugin;
import io.vortexcore.math.ExperienceCurve;
import io.vortexcore.persistence.PlayerDataRepository;
import io.vortexcore.persistence.model.PlayerSnapshot;
import io.vortexcore.player.UnifiedPlayer;
import io.vortexcore.rpg.*;
import io.vortexcore.scheduling.FoliaExecutionFacade;
import io.vortexcore.talent.*;
import java.lang.reflect.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Logger;
import org.bukkit.*;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.plugin.PluginManager;

/** Real native service/queue/profile/class skills + real bridge; only repository futures are doubles. */
public final class PointMigrationTest {
    static int checks;
    static final Thread MAIN = Thread.currentThread();
    static final Map<UUID, Player> PLAYERS = new HashMap<>();
    static final List<Runnable> GLOBAL = new ArrayList<>();
    static final String HASH = "a".repeat(64);
    static final Logger LOG = Logger.getLogger("synthetic-point-migration");
    static void check(boolean value, String message) { if (!value) throw new AssertionError(message); checks++; }
    static Object defaults(Class<?> type) {
        if (!type.isPrimitive()) return null;
        if (type == boolean.class) return false;
        if (type == double.class) return 0d;
        if (type == float.class) return 0f;
        if (type == long.class) return 0L;
        if (type == byte.class) return (byte) 0;
        if (type == short.class) return (short) 0;
        if (type == char.class) return (char) 0;
        return 0;
    }
    @SuppressWarnings("unchecked") static <T> T proxy(Class<T> type, InvocationHandler handler) {
        return (T) Proxy.newProxyInstance(PointMigrationTest.class.getClassLoader(), new Class<?>[]{type}, handler);
    }
    static void field(Object object, String name, Object value) throws Exception {
        for (Class<?> type = object.getClass(); type != null; type = type.getSuperclass()) {
            try { var f = type.getDeclaredField(name); f.setAccessible(true); f.set(object, value); return; }
            catch (NoSuchFieldException ignored) {}
        }
        throw new NoSuchFieldException(name);
    }
    @SuppressWarnings("unchecked") static <T> T uninitialized(Class<T> type) throws Exception {
        var f = sun.misc.Unsafe.class.getDeclaredField("theUnsafe"); f.setAccessible(true);
        return (T) ((sun.misc.Unsafe) f.get(null)).allocateInstance(type);
    }
    static void installServer() throws Exception {
        PluginManager manager = proxy(PluginManager.class, (p, m, a) -> defaults(m.getReturnType()));
        Server server = proxy(Server.class, (p, m, a) -> switch (m.getName()) {
            case "isPrimaryThread" -> Thread.currentThread() == MAIN;
            case "getLogger" -> LOG;
            case "getName", "getVersion", "getBukkitVersion" -> "synthetic-api-test";
            case "getPluginManager" -> manager;
            case "getPlayer" -> a[0] instanceof UUID id ? PLAYERS.get(id) : null;
            default -> defaults(m.getReturnType());
        });
        var serverField = Bukkit.class.getDeclaredField("server"); serverField.setAccessible(true); serverField.set(null, server);
    }
    static FoliaExecutionFacade scheduler() {
        return proxy(FoliaExecutionFacade.class, (p, m, a) -> {
            if (m.getName().equals("runGlobal")) { GLOBAL.add((Runnable) a[1]); return null; }
            if (m.getName().equals("runEntity")) { ((Runnable) a[a.length - 1]).run(); return true; }
            return defaults(m.getReturnType());
        });
    }
    @SuppressWarnings("unchecked") static Map<UUID, UnifiedPlayer> cache(PlayerProfileService service) throws Exception {
        var f = PlayerProfileService.class.getDeclaredField("profiles"); f.setAccessible(true);
        return (Map<UUID, UnifiedPlayer>) f.get(service);
    }
    @SuppressWarnings("unchecked") static Set<UUID> loading(PlayerProfileService service) throws Exception {
        var f = PlayerProfileService.class.getDeclaredField("loadingPlayers"); f.setAccessible(true);
        return (Set<UUID>) f.get(service);
    }
    static final class Fixture {
        final UUID actor = UUID.randomUUID();
        final PlayerDataRepository repository = new PlayerDataRepository();
        final ClassSkillService skills = new ClassSkillService(null, scheduler(), null, null, null, 100);
        final ExperienceCurve curve = ExperienceCurve.cubic(100, 2);
        final PlayerProfileService profiles = new PlayerProfileService(null, LOG, scheduler(), repository, skills, null, null, null, curve);
        final TalentRepository talentRepository = new TalentRepository();
        final List<String> messages = new ArrayList<>();
        final Player player;
        final VortexBridge bridge;
        UnifiedPlayer state;
        boolean online = true;
        Fixture() throws Exception {
            player = proxy(Player.class, (p, m, a) -> switch (m.getName()) {
                case "getUniqueId" -> actor;
                case "getName" -> "synthetic-actor";
                case "isOnline", "isValid" -> online;
                case "getGameMode" -> GameMode.SURVIVAL;
                case "getHealth", "getMaxHealth" -> 20d;
                case "sendMessage" -> { if (a[0] instanceof String message) messages.add(message); yield null; }
                case "toString" -> "synthetic-player";
                default -> defaults(m.getReturnType());
            });
            PLAYERS.put(actor, player);
            state = new UnifiedPlayer(actor, "synthetic-actor");
            state.applySnapshot(new PlayerSnapshot(actor, 0, 7, 900, Map.of(), Map.of("rpg.class", "knight", "rpg.skill_points", "5", "historic", "keep"), Instant.EPOCH));
            cache(profiles).put(actor, state); skills.setPlayerProfileService(profiles);
            var registry = new TalentRegistry(null, LOG);
            var node = new TalentNodeDefinition("synthetic_talent", "独立天赋", "只读", 0, 0, List.of(), 2, Map.of(), null);
            field(registry, "trees", Map.of(VortexClass.KNIGHT, new TalentTreeDefinition(VortexClass.KNIGHT, Map.of(node.id(), node))));
            var talents = uninitialized(TalentService.class);
            field(talents, "repository", talentRepository); field(talents, "registry", registry);
            talentRepository.data.complete(new PlayerTalentData(actor, 0, Map.of("knight", Set.of(node.id())), 3, Instant.EPOCH));
            var core = uninitialized(VortexCorePlugin.class);
            field(core, "playerProfileService", profiles); field(core, "classSkillService", skills); field(core, "talentService", talents);
            bridge = uninitialized(VortexBridge.class);
            field(bridge, "vortex", core); field(bridge, "professionView", new ProfessionOverview()); field(bridge, "legacyPoints", new NativeLegacyPoints());
            var config = new YamlConfiguration(); config.set("backend", "vortex"); field(bridge, "newConfig", config);
        }
        LegacyPointMigration.Source source(int earned, int spent) {
            return new LegacyPointMigration.Source(actor, earned, spent, HASH, bridge.legacyPointsTransferId(player, HASH));
        }
        CompletableFuture<JsonObject> migrate(LegacyPointMigration.Source source) {
            return bridge.migrateLegacyPoints(player, source.earned(), source.spent(), source.sourceHash(), source.transferId());
        }
        int balance() { return skills.unspentSkillPoints(state); }
        void coldLoad(PlayerSnapshot snapshot) throws Exception {
            state = new UnifiedPlayer(actor, "synthetic-actor"); state.applySnapshot(snapshot); cache(profiles).put(actor, state);
            field(bridge, "legacyPoints", new NativeLegacyPoints());
        }
    }
    static final class Store implements LegacyPointMigration.SourceStore {
        LegacyPointMigration.Source frozen;
        CompletableFuture<LegacyPointMigration.Source> intent;
        boolean failConfirm;
        boolean throwConfirm;
        int receipts;
        final Set<String> confirmedTransfers = new HashSet<>();
        final JsonObject historical = JsonParser.parseString("{\"points\":{\"earned\":14,\"spent\":3},\"levels\":{\"old\":9},\"skills\":{\"historic\":true}}").getAsJsonObject();
        public CompletableFuture<LegacyPointMigration.Source> prepare(LegacyPointMigration.Source requested) {
            if (intent != null) return intent;
            if (frozen == null) frozen = requested;
            return CompletableFuture.completedFuture(frozen);
        }
        public CompletableFuture<Void> confirm(LegacyPointMigration.Source source, JsonObject target) {
            check(source.equals(frozen), "source receipt actor/payload bound");
            if (throwConfirm) throw new IllegalStateException("source_sync_unknown");
            if (failConfirm) return CompletableFuture.failedFuture(new IllegalStateException("source_unknown"));
            if (confirmedTransfers.add(source.transferId())) receipts++;
            return CompletableFuture.completedFuture(null);
        }
    }
    static boolean confirmed(JsonObject out) { return out.get("confirmed").getAsBoolean(); }
    static void arithmetic() throws Exception {
        var f = new Fixture();
        check(f.source(14, 3).amount() == 11, "authorized 1:1 per-profile arithmetic");
        check(f.source(3, 14).amount() == 0, "overspent safe zero, not summed debt offset");
        check(f.source(Integer.MAX_VALUE, 0).amount() == Integer.MAX_VALUE, "max arithmetic uses long subtraction");
        check(f.source(0, Integer.MAX_VALUE).amount() == 0, "max overspent safe");
        boolean bad = false; try { f.source(-1, 0); } catch (IllegalArgumentException expected) { bad = true; }
        check(bad, "negative source rejected");
        f.state.putMetadata("rpg.skill_points", Integer.toString(Integer.MAX_VALUE));
        var out = f.migrate(f.source(1, 0)).join();
        check(!confirmed(out) && out.get("reason").getAsString().equals("integer_overflow"), "addition overflow rejected");
        check(f.repository.captures.isEmpty() && !f.state.metadata().containsKey(LegacyPointMigration.RECEIPT_FIELD), "overflow writes nothing");
        for (String invalid : List.of("-1", "garbled", "2147483648")) {
            var invalidFixture = new Fixture(); invalidFixture.state.putMetadata("rpg.skill_points", invalid);
            check(!confirmed(invalidFixture.migrate(invalidFixture.source(1, 0)).join()) && invalidFixture.repository.captures.isEmpty(), "native parse error not zero fallback");
        }
        for (int[] pair : List.of(new int[]{0, 0}, new int[]{4, 4}, new int[]{2, 9})) {
            var zero = new Fixture(); var future = zero.migrate(zero.source(pair[0], pair[1]));
            check(zero.balance() == 5 && zero.repository.captures.size() == 1, "zero creates receipt but not extra points");
            zero.repository.confirm(0); check(confirmed(future.join()), "zero durable receipt confirmed");
        }
    }
    static void readiness() throws Exception {
        var f = new Fixture(); var source = f.source(14, 3);
        f.online = false; check(f.migrate(source).join().get("pending").getAsBoolean(), "offline pending");
        f.online = true; loading(f.profiles).add(f.actor);
        check(f.migrate(source).join().get("reason").getAsString().equals("profile_loading"), "loading pending");
        loading(f.profiles).clear(); cache(f.profiles).remove(f.actor);
        check(f.migrate(source).join().get("pending").getAsBoolean(), "missing original pending, no constructed profile");
        check(cache(f.profiles).isEmpty(), "read/migration never computeIfAbsent original");
        cache(f.profiles).put(f.actor, f.state); f.state.putMetadata("rpg.class", "");
        var none = f.migrate(source).join();
        check(none.get("pending").getAsBoolean() && none.get("nextCommand").getAsString().equals("/mycli profession list"), "no class pending with choose/list hint");
        check(f.repository.captures.isEmpty() && f.balance() == 5, "all readiness gates before credit");
        check(!confirmed(f.bridge.migrateLegacyPoints(f.player, 14, 3, HASH, LegacyPointMigration.transferId(UUID.randomUUID(), HASH)).join()), "cross actor transfer rejected");
        cache(f.profiles).put(f.actor, new UnifiedPlayer(UUID.randomUUID(), "synthetic-mismatch"));
        check(f.migrate(source).join().get("reason").getAsString().equals("actor_mismatch"), "cached profile actor mismatch rejected");
    }
    static void duplicateAndUnknown() throws Exception {
        var f = new Fixture(); var source = f.source(14, 3); var future = f.migrate(source);
        check(f.balance() == 16 && !future.isDone(), "credit in memory is NOT persistent success");
        check(future == f.migrate(source) && f.repository.captures.size() == 1, "same actor duplicated transfer shares flight");
        check(f.migrate(f.source(15, 3)).join().get("status").getAsString().equals("rejected"), "different payload same ID rejects in flight");
        var snapshot = f.repository.captures.getFirst();
        check(source.receipt().equals(snapshot.metadata().get(LegacyPointMigration.RECEIPT_FIELD)) && snapshot.metadata().get("rpg.skill_points").equals("16"), "receipt and credit same native snapshot");
        check(snapshot.metadata().get("historic").equals("keep") && snapshot.experience() == 900 && snapshot.level() == 7, "unrelated history XP/level preserved");
        f.repository.unknown(0); check(!confirmed(future.join()), "failed future never fake confirmed");
        var retry = f.migrate(source); check(f.balance() == 16 && f.repository.captures.size() == 2 && !retry.isDone(), "unknown reconciles marker only; no replay grant");
        f.repository.confirm(1); check(confirmed(retry.join()), "receipt-only native save confirms");
        var duplicate = f.migrate(source); check(f.balance() == 16 && !duplicate.isDone(), "even live marker is not guessed durable");
        f.repository.confirm(2); check(confirmed(duplicate.join()) && f.balance() == 16, "duplicate never credits twice");
        check(f.migrate(f.source(16, 3)).join().get("reason").getAsString().equals("receipt_payload_mismatch"), "persisted same ID payload mismatch");
        var lookalike = new Fixture(); lookalike.state.putMetadata("rpg.skill_points", "16");
        var notReceipt = lookalike.migrate(lookalike.source(14, 3));
        check(lookalike.balance() == 27 && !notReceipt.isDone(), "equal-looking balance is NOT success/receipt inference");
        lookalike.repository.confirm(0); check(confirmed(notReceipt.join()), "receipt after actual authorized credit");
    }
    static void earlierSaveWindow() throws Exception {
        var f = new Fixture(); var source = f.source(14, 3);
        var earlier = f.profiles.qiandengjiSave(f.player);
        var migration = f.migrate(source);
        check(f.repository.captures.size() == 1 && f.balance() == 16, "migration batch queues behind pre-credit autosave");
        var worker = new Thread(() -> f.repository.confirm(0)); worker.start(); worker.join(); earlier.join();
        check(f.balance() == 16 && source.receipt().equals(f.state.metadata().get(LegacyPointMigration.RECEIPT_FIELD)), "earlier snapshot ack cannot erase new credit/receipt");
        var target = f.repository.captures.get(1);
        check(target.metadata().get("rpg.skill_points").equals("16") && source.receipt().equals(target.metadata().get(LegacyPointMigration.RECEIPT_FIELD)), "delayed target snapshot still atomic credit/receipt");
        f.repository.confirm(1); check(confirmed(migration.join()), "queued batch confirmed only after own durable save");
        var stale = new UnifiedPlayer(f.actor, "synthetic-stale");
        boolean rejected = false;
        try { f.profiles.qiandengjiSaveMetadata(f.player, stale, Map.of("rpg.skill_points", "999")).join(); }
        catch (CompletionException expected) { rejected = true; }
        check(rejected && stale.metadata().isEmpty() && f.balance() == 16, "native batch rejects stale/stand-in profile before writes");
        var offthread = new CompletableFuture<JsonObject>();
        var thread = new Thread(() -> offthread.complete(f.migrate(source).join())); thread.start(); thread.join();
        check(offthread.join().get("pending").getAsBoolean() && f.repository.captures.size() == 2, "migration off main never updates metadata or queues IO");
    }
    static void concurrentState() throws Exception {
        var f = new Fixture(); var source = f.source(14, 3); var migration = f.migrate(source);
        var node = f.skills.skillsFor(f.state).stream().filter(n -> n.requiredLevel() <= f.state.level() && n.cost() > 0).findFirst().orElseThrow();
        var learned = f.skills.unlockSkill(f.player, f.state, node.id());
        check(learned.join().success(), "real native unlockSkill executes during pending migration save");
        int remaining = 16 - node.cost();
        f.state.grantExperience(10000, f.curve); int level = f.state.level(); long xp = f.state.experience();
        var later = f.profiles.qiandengjiSave(f.player);
        check(f.repository.captures.size() == 1, "native second save queues behind migration IO");
        // Capture was owned/main thread already; subsequent writes must not affect queued snapshot.
        f.state.putMetadata("later_unsaved", "keep_live");
        var worker = new Thread(() -> f.repository.confirm(0)); worker.start(); worker.join();
        check(confirmed(migration.join()), "target confirmation can finish on IO thread");
        check(f.balance() == remaining && f.state.level() == level && f.state.experience() == xp, "durable ack never reapplies old balance/XP/level");
        check(f.skills.unlockedSkillIds(f.state).contains(node.id()) && f.state.metadata().containsKey("later_unsaved"), "learning and postcapture metadata retained live");
        var queued = f.repository.captures.get(1);
        check(queued.level() == level && queued.experience() == xp && queued.metadata().get("rpg.skill_points").equals(Integer.toString(remaining)), "queued immutable owned snapshot contains concurrent learned/XP state");
        check(!queued.metadata().containsKey("later_unsaved") && queued.revision() == 1, "capture not IO-thread read; revision rebased after prior ack");
        check(source.receipt().equals(queued.metadata().get(LegacyPointMigration.RECEIPT_FIELD)), "native learning preserves receipt");
        f.repository.confirm(1); later.join(); check(f.state.snapshotRevision() == 2, "native revision monotonic");
        f.state.qiandengjiSavedRevision(1); check(f.state.snapshotRevision() == 2, "stale ack cannot lower revision");
        var fromWorker = new CompletableFuture<CompletableFuture<PlayerSnapshot>>();
        var thread = new Thread(() -> fromWorker.complete(f.profiles.qiandengjiSave(f.player))); thread.start(); thread.join();
        check(!fromWorker.join().isDone() && f.repository.captures.size() == 2, "offthread save defers owned capture");
        GLOBAL.removeFirst().run(); check(f.repository.captures.size() == 3, "deferred capture on main thread");
        f.repository.confirm(2); fromWorker.join().join();
    }
    static void crashAndSource() throws Exception {
        var f = new Fixture(); var source = f.source(14, 3); var store = new Store();
        store.intent = new CompletableFuture<>(); var calls = new AtomicInteger();
        var waiting = LegacyPointMigration.migrate(source, store, s -> { calls.incrementAndGet(); return f.migrate(s); });
        check(calls.get() == 0 && f.balance() == 5, "intent must be durable before target credit");
        store.intent.completeExceptionally(new IllegalStateException("intent_unknown"));
        check(!confirmed(waiting.join()) && calls.get() == 0, "unknown source intent never invokes target");
        store.intent = null; store.frozen = source; store.failConfirm = true;
        JsonObject historical = store.historical.deepCopy();
        PlayerSnapshot beforeTarget = f.state.toSnapshot();
        var target = LegacyPointMigration.migrate(source, store, f::migrate);
        // Crash after metadata/capture, BEFORE target write: cold profile has no marker.
        f.repository.unknown(0); f.coldLoad(beforeTarget);
        check(!confirmed(target.join()), "pre-target-write crash pending");
        var afterCrash = LegacyPointMigration.migrate(source, store, f::migrate);
        check(f.balance() == 16, "cold no-receipt resumes original intent exactly once");
        // Crash AFTER atomic file write but BEFORE successful future/source receipt.
        PlayerSnapshot written = f.repository.captures.get(1).nextRevision();
        f.repository.durable = written; f.repository.unknown(1); f.coldLoad(written);
        check(!confirmed(afterCrash.join()), "target written but unknown future never claims success");
        var reconciled = LegacyPointMigration.migrate(source, store, f::migrate);
        check(f.balance() == 16, "cold persisted receipt suppresses double credit");
        f.repository.confirm(2); var unknownSource = reconciled.join();
        check(confirmed(unknownSource) && unknownSource.get("pending").getAsBoolean() && !unknownSource.get("sourceConfirmed").getAsBoolean(), "target confirmed/source unknown explicit");
        store.failConfirm = false;
        var receiptRetry = LegacyPointMigration.migrate(source, store, f::migrate);
        check(f.balance() == 16, "source-unknown recovery never recredits native");
        f.repository.confirm(3);
        check(receiptRetry.join().get("sourceConfirmed").getAsBoolean() && store.receipts == 1, "source receipt follows durable target ack");
        check(historical.equals(store.historical), "legacy earned/spent/levels/skills remain history");
        var alreadyConfirmed = LegacyPointMigration.migrate(source, store, f::migrate);
        check(f.balance() == 16, "duplicate fully confirmed source does not credit twice");
        f.repository.confirm(4);
        check(alreadyConfirmed.join().get("sourceConfirmed").getAsBoolean() && store.receipts == 1, "source receipt is idempotent");
        var changed = LegacyPointMigration.migrate(f.source(15, 3), store, f::migrate).join();
        check(changed.get("status").getAsString().equals("rejected") && f.repository.captures.size() == 5, "frozen source mismatch cannot reach target");
        var invalid = LegacyPointMigration.migrate(source, store, s -> { var out = s.result("synthetic", true, false); out.addProperty("spent", 999); return CompletableFuture.completedFuture(out); }).join();
        check(!confirmed(invalid) && store.receipts == 1, "mismatched target confirmation cannot mark source");
        store.throwConfirm = true;
        var syncSourceUnknown = LegacyPointMigration.migrate(source, store, f::migrate);
        f.repository.confirm(5); var syncUnknown = syncSourceUnknown.join();
        check(confirmed(syncUnknown) && syncUnknown.get("pending").getAsBoolean() && syncUnknown.get("reason").getAsString().equals("target_confirmed_source_unknown"), "synchronous source failure preserves known native confirmation");
    }
    static void badSnapshot() throws Exception {
        var f = new Fixture(); var result = f.migrate(f.source(14, 3));
        f.repository.futures.getFirst().complete(new PlayerSnapshot(f.actor, 1, 7, 900, Map.of(), Map.of("rpg.skill_points", "16"), Instant.EPOCH));
        check(!confirmed(result.join()), "successful future WITHOUT receipt cannot confirm");
        var other = new Fixture(); var mismatch = other.migrate(other.source(14, 3));
        var captured = other.repository.captures.getFirst();
        other.repository.futures.getFirst().complete(new PlayerSnapshot(UUID.randomUUID(), 1, captured.level(), captured.experience(), captured.stats(), captured.metadata(), Instant.EPOCH));
        check(!confirmed(mismatch.join()), "successful snapshot for wrong actor rejected");
        var noRepo = new Fixture(); field(noRepo.profiles, "repository", null);
        check(!confirmed(noRepo.migrate(noRepo.source(14, 3)).join()) && noRepo.balance() == 5, "null native repository never pseudo-saved or credit mutation");
    }
    static void overview() throws Exception {
        var f = new Fixture(); var before = f.state.toSnapshot();
        var out = f.bridge.professionOverview(f.player);
        for (String key : List.of("queryOnly", "available", "loading", "classId", "className", "level", "xp", "xpTotal", "xpProgress", "xpRequired", "xpRemaining", "learningPoints", "unspent", "skills", "unlockedSkillIds", "talents"))
            check(out.has(key), "overview complete field " + key);
        check(out.get("queryOnly").getAsBoolean() && out.get("classId").getAsString().equals("knight"), "overview real selected class");
        check(out.get("unspent").getAsInt() == 5 && out.getAsJsonObject("talents").get("points").getAsInt() == 3, "learning points and talent points distinct native resources");
        check(!out.getAsJsonArray("skills").isEmpty() && out.getAsJsonArray("skills").get(0).getAsJsonObject().has("cost"), "native skill costs/unlocked exposed");
        check(out.getAsJsonObject("talents").getAsJsonArray("nodes").get(0).getAsJsonObject().get("allocated").getAsBoolean(), "native talent allocated state");
        for (String[] route : List.of(new String[]{"profession", "--json"}, new String[]{"profession", "status", "--json"}, new String[]{"profession", "summary", "--json"}, new String[]{"class", "status", "--json"}, new String[]{"skills", "list", "profession", "--json"})) {
            f.messages.clear(); f.bridge.onCommand(f.player, null, "qdrpg", route);
            check(f.messages.size() == 1 && JsonParser.parseString(f.messages.getFirst().substring("MC_RPG ".length())).equals(out), "same JSON data all profession routes/alias");
        }
        for (String[] route : List.of(new String[]{"profession"}, new String[]{"profession", "summary"}, new String[]{"profession", "status"})) {
            f.messages.clear(); f.bridge.onCommand(f.player, null, "qdrpg", route);
            check(f.messages.equals(List.of("[RPG] " + ProfessionOverview.text(out))), "same plain renderer for default/summary/status");
        }
        check(before.metadata().equals(f.state.metadata()) && before.level() == f.state.level() && before.experience() == f.state.experience() && f.repository.captures.isEmpty(), "overview/routes no mutation or migration");
        loading(f.profiles).add(f.actor); var loading = f.bridge.professionOverview(f.player);
        check(!loading.get("available").getAsBoolean() && loading.get("loading").getAsBoolean() && loading.get("unspent").isJsonNull(), "overview loading same original source; unknown not zero");
        f.messages.clear(); f.bridge.onCommand(f.player, null, "qdrpg", new String[]{"profession", "--json"});
        check(f.messages.getFirst().contains("profile_loading"), "loading command still exposes overview not generic error");
        loading(f.profiles).clear(); f.online = false;
        check(!f.bridge.professionOverview(f.player).get("available").getAsBoolean(), "overview offline unavailable");
        var delayed = new Fixture(); delayed.talentRepository.data = new CompletableFuture<>(); field(delayed.bridge, "professionView", new ProfessionOverview());
        var waiting = delayed.bridge.professionOverview(delayed.player);
        check(waiting.get("available").getAsBoolean() && waiting.getAsJsonObject("talents").get("loading").getAsBoolean() && waiting.getAsJsonObject("talents").get("points").isJsonNull(), "talents asynchronous no tick-thread wait/zero fabrication");
        delayed.talentRepository.data.completeExceptionally(new IllegalStateException("synthetic"));
        check(!delayed.bridge.professionOverview(delayed.player).getAsJsonObject("talents").get("available").getAsBoolean(), "failed talent future not empty successful allocation");
    }
    public static void main(String[] args) throws Exception {
        installServer(); arithmetic(); readiness(); duplicateAndUnknown(); earlierSaveWindow(); concurrentState(); crashAndSource(); badSnapshot(); overview();
        System.out.println("PointMigrationTest: " + checks + " passed; realNativeMethods=true; onlyExternalSaveFuturesStubbed=true; realGame=false");
    }
}
