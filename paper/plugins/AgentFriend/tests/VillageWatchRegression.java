package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.File;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.UUID;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.Chunk;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Raid;
import org.bukkit.Server;
import org.bukkit.World;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Player;
import org.bukkit.entity.Raider;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitScheduler;
import sun.misc.Unsafe;

/** Actual manager regression against the old all-world selection, without Minecraft or disk writes. */
public final class VillageWatchRegression {
    public static void main(String[] args) throws Exception {
        Env env = new Env(); env.install();
        env.add(-678, -64, -500); env.add(-421.001, 320, -500); // Both inclusive block-column edges.
        env.add(-678.001, 64, -500); env.add(-421, 64, -500); // Outside the old block-coordinate boundary.
        env.add(-500, -1e12, -578); env.add(-500, 1e12, -331.001); // No Y restriction in the old rule.
        env.add(-664, 64, -564); // Outside rounded corner: 34^2 + 34^2 > 48^2.
        env.add(-663, 64, -564); // Inside rounded corner.
        env.add(-620, 64, -520).valid = false;
        env.add(-621, 64, -520).dead = true;
        env.add(-622, 64, -520).location = new Location(env.otherWorld, -622, 64, -520);
        Random random = new Random(0x5144);
        for (int i = 0; i < 300; i++) env.add(-710 + random.nextDouble() * 330,
                i % 2 == 0 ? -300 : 1000, -610 + random.nextDouble() * 310);
        for (int i = 0; i < 50_000; i++) env.add(10_000 + i * 16.0, 64, 20_000);
        Mob unloaded = env.add(-640, 64, -496);
        env.index();
        // Remove an occupied local chunk entirely: callers must not fetch it.
        env.loaded.remove(new Key(-40, -31));
        Key empty = null;
        for (int x = -43; x <= -27 && empty == null; x++) for (int z = -37; z <= -21; z++) {
            Key candidate = new Key(x, z);
            if (!env.byChunk.containsKey(candidate)) { empty = candidate; break; }
        }
        check(empty != null, "fixture has no empty chunk");
        env.loaded.add(empty); // Loaded empty chunk remains harmless.
        VillageWatchManager manager = manager(env);
        Method near = method("nearVillage", Location.class);
        Set<UUID> before = new HashSet<>();
        long oldVisited = 0;
        for (Mob mob : env.mobs) {
            if (!env.loaded.contains(key(mob.location))) continue;
            oldVisited++;
            if (mob.valid && !mob.dead && (boolean) near.invoke(manager, mob.location)) before.add(mob.id);
        }
        env.resetCounters();
        @SuppressWarnings("unchecked") List<Raider> selected = (List<Raider>) method("nearbyRaiders", World.class).invoke(manager, env.world);
        Set<UUID> after = new HashSet<>();
        for (Raider raider : selected) after.add(raider.getUniqueId());
        check(before.equals(after), "local query changed the legal Raider set");
        check(env.chunkChecks == 289 && env.chunkGets <= 289, "village footprint is no longer fixed at 289 checks");
        check(env.entityVisits < 1000 && env.globalQueries == 0, "local query touched remote world entities");
        check(env.emptyChunkGets > 0 && !after.contains(unloaded.id), "loaded empty/unloaded occupied chunk guards failed");
        check(after.contains(env.mobs.get(0).id) && after.contains(env.mobs.get(1).id), "fractional edge omitted");
        check(after.contains(env.mobs.get(4).id) && after.contains(env.mobs.get(5).id), "Y range was narrowed");
        check(!after.contains(env.mobs.get(6).id) && after.contains(env.mobs.get(7).id), "rounded corner changed");
        System.out.printf("all-world visits=%d -> fixed chunk checks=%d; local entity visits=%d; matched Raiders=%d%n",
                oldVisited, env.chunkChecks, env.entityVisits, after.size());
        Object patrol = snapshot(manager);
        check(value(patrol, "active").equals(true) && value(patrol, "source").equals("patrol"), "patrol missing");
        Location patrolAt = (Location) value(patrol, "at");
        check((boolean) near.invoke(manager, patrolAt) && selected.stream().anyMatch(mob -> mob.getLocation().equals(patrolAt)),
                "patrol coordinate is not a legal selected Raider");

        // Raid priority and lifecycle are independent of the Raider query/order.
        RaidState inactive = new RaidState(env.world, -600, 64, -500); inactive.status = Raid.RaidStatus.STOPPED;
        RaidState foreign = new RaidState(env.otherWorld, -600, 64, -500);
        RaidState outside = new RaidState(env.world, -800, 64, -500);
        RaidState raid = new RaidState(env.world, -600, 1000, -500);
        env.raids.addAll(List.of(inactive.proxy, foreign.proxy, outside.proxy, raid.proxy));
        Object raidThreat = snapshot(manager);
        check(value(raidThreat, "source").equals("raid") && value(raidThreat, "at").equals(raid.at)
                && value(raidThreat, "count").equals(after.size()), "Raid priority/status/world boundary changed");
        env.raids.clear();
        for (Mob mob : env.mobs) mob.dead = true;
        check(value(snapshot(manager), "active").equals(false), "empty local threat remained active");
        raid.at = new Location(env.world, -800, -300, -500); env.raids.add(raid.proxy);
        check(value(snapshot(manager), "active").equals(false), "outside Raid became active");
        raid.at = new Location(env.world, -600, -300, -500);
        Object moved = snapshot(manager);
        check(value(moved, "active").equals(true) && value(moved, "count").equals(0), "natural Raid entering boundary was missed without Raiders");
        env.available = false;
        check(value(snapshot(manager), "active").equals(false), "missing overworld did not remain safe");

        verifyDeathsAndLiveStatus();
        System.out.println("PASS: identical legal Raider set, loaded/empty chunks, fractional rounded boundaries,"
                + " all Y, dimension/Raid guards; same-tick deaths coalesced and public status stays fresh.");
    }

    private static void verifyDeathsAndLiveStatus() throws Exception {
        Env env = new Env(); env.install();
        Mob first = env.add(-600, 64, -500), second = env.add(-601, 64, -500), third = env.add(-602, 64, -500);
        env.index();
        VillageWatchManager manager = manager(env);
        Person one = new Person("AgentOne"), two = new Person("AgentTwo");
        String day = LocalDate.now(ZoneId.of("Asia/Shanghai")).toString();
        for (Person person : List.of(one, two)) env.config.set("village-defense." + person.id + "." + day + ".rewarded", true);
        first.killer = one.proxy; second.killer = two.proxy; first.dead = second.dead = true;
        manager.onRaiderDeath(new EntityDeathEvent(first.proxy, null, new ArrayList<>()));
        manager.onRaiderDeath(new EntityDeathEvent(second.proxy, null, new ArrayList<>()));
        check(env.pending.size() == 1, "two same-tick deaths scheduled duplicate scans");
        check(env.config.saves == 2, "death persistence was delayed/coalesced");
        check(env.config.getInt("village-defense." + one.id + "." + day + ".kills") == 1
                && env.config.getInt("village-defense." + two.id + "." + day + ".kills") == 1, "different killers shared defense counts");
        check(one.payloads.get(0).get("kind").getAsString().equals("defense")
                && two.payloads.get(0).get("kind").getAsString().equals("defense"), "immediate defense receipt lost");
        third.dead = true;
        manager.command(one.proxy, new String[] {"village", "status"});
        JsonObject clear = last(one);
        check(!clear.get("active").getAsBoolean() && clear.get("count").getAsInt() == 0,
                "public status reused cached/pending death state");
        RaidState entered = new RaidState(env.world, -600, 1000, -500); env.raids.add(entered.proxy);
        manager.command(two.proxy, new String[] {"village", "threat"});
        check(last(two).get("active").getAsBoolean() && last(two).get("source").getAsString().equals("raid"),
                "public status didn't see an entering Raid while a scan was pending");
        env.resetCounters(); env.pending.remove(0).run();
        check(env.chunkChecks == 289 && manager.activeThreat(), "next-tick scan didn't read newest world state");
        check(env.pending.isEmpty(), "drain left a duplicate scan");
        third.killer = one.proxy;
        manager.onRaiderDeath(new EntityDeathEvent(third.proxy, null, new ArrayList<>()));
        check(env.pending.size() == 1 && env.config.saves == 3, "pending flag wasn't released after scan");
    }

    private static VillageWatchManager manager(Env env) throws Exception {
        AgentFriendPlugin plugin = allocate(AgentFriendPlugin.class);
        field(JavaPlugin.class, "newConfig").set(plugin, env.config);
        field(JavaPlugin.class, "configFile").set(plugin, new File("unused-regression.yml"));
        field(JavaPlugin.class, "logger").set(plugin, Logger.getLogger("VillageWatchRegression"));
        VillageWatchManager manager = allocate(VillageWatchManager.class);
        field(VillageWatchManager.class, "plugin").set(manager, plugin);
        field(VillageWatchManager.class, "current").set(manager, snapshot(manager));
        return manager;
    }

    private static final class MemoryConfig extends YamlConfiguration {
        int saves;
        @Override public void save(File file) { saves++; } // Never writes or reads any server data.
    }

    private record Key(int x, int z) { }
    private static Key key(Location location) { return new Key(location.getBlockX() >> 4, location.getBlockZ() >> 4); }
    private static final class Env {
        final MemoryConfig config = new MemoryConfig();
        final List<Mob> mobs = new ArrayList<>();
        final List<Raid> raids = new ArrayList<>();
        final Set<Key> loaded = new HashSet<>();
        final Map<Key, List<Mob>> byChunk = new HashMap<>();
        final List<Runnable> pending = new ArrayList<>();
        final World world, otherWorld;
        boolean available = true;
        int chunkChecks, chunkGets, entityVisits, globalQueries, emptyChunkGets;

        Env() {
            otherWorld = (World) Proxy.newProxyInstance(World.class.getClassLoader(), new Class<?>[] {World.class},
                    (proxy, method, values) -> identity(proxy, method.getName(), values));
            world = (World) Proxy.newProxyInstance(World.class.getClassLoader(), new Class<?>[] {World.class},
                    (proxy, method, values) -> switch (method.getName()) {
                        case "hashCode", "equals" -> identity(proxy, method.getName(), values);
                        case "getRaids" -> raids;
                        case "isChunkLoaded" -> { chunkChecks++; yield loaded.contains(new Key((int) values[0], (int) values[1])); }
                        case "getChunkAt" -> {
                            Key key = new Key((int) values[0], (int) values[1]);
                            check(loaded.contains(key), "getChunkAt requested an unloaded chunk"); chunkGets++;
                            if (!byChunk.containsKey(key)) emptyChunkGets++;
                            yield Proxy.newProxyInstance(Chunk.class.getClassLoader(), new Class<?>[] {Chunk.class},
                                    (chunk, call, args) -> {
                                        check(call.getName().equals("getEntities"), "unexpected chunk action: " + call.getName());
                                        List<Mob> local = byChunk.getOrDefault(key, List.of()); entityVisits += local.size();
                                        return local.stream().map(mob -> mob.proxy).toArray(Entity[]::new);
                                    });
                        }
                        case "getEntitiesByClass" -> { globalQueries++; throw new AssertionError("production scanned all world entities"); }
                        default -> throw new AssertionError("Unexpected world action: " + method.getName());
                    });
        }
        Mob add(double x, double y, double z) { Mob mob = new Mob(new Location(world, x, y, z)); mobs.add(mob); return mob; }
        void index() {
            byChunk.clear(); loaded.clear();
            for (Mob mob : mobs) { Key key = key(mob.location); loaded.add(key); byChunk.computeIfAbsent(key, ignored -> new ArrayList<>()).add(mob); }
        }
        void resetCounters() { chunkChecks = chunkGets = entityVisits = globalQueries = emptyChunkGets = 0; }
        void install() throws Exception {
            BukkitScheduler scheduler = (BukkitScheduler) Proxy.newProxyInstance(BukkitScheduler.class.getClassLoader(),
                    new Class<?>[] {BukkitScheduler.class}, (proxy, method, values) -> {
                        check(method.getName().equals("runTaskLater") && values[1] instanceof Runnable
                                && ((Long) values[2]) == 1L, "unexpected scheduling action");
                        pending.add((Runnable) values[1]); return null;
                    });
            Server server = (Server) Proxy.newProxyInstance(Server.class.getClassLoader(), new Class<?>[] {Server.class},
                    (proxy, method, values) -> switch (method.getName()) {
                        case "getWorld" -> available && values[0].equals("world") ? world : null;
                        case "getScheduler" -> scheduler;
                        case "getOnlinePlayers" -> List.of();
                        default -> throw new AssertionError("Unexpected server action: " + method.getName());
                    });
            field(Bukkit.class, "server").set(null, server);
        }
    }

    private static final class Mob {
        final UUID id = UUID.randomUUID();
        final Raider proxy;
        Location location;
        boolean valid = true, dead;
        Player killer;
        Mob(Location location) {
            this.location = location;
            proxy = (Raider) Proxy.newProxyInstance(Raider.class.getClassLoader(), new Class<?>[] {Raider.class},
                    (self, method, values) -> switch (method.getName()) {
                        case "isValid" -> valid;
                        case "isDead" -> dead;
                        case "getLocation" -> this.location.clone();
                        case "getUniqueId" -> id;
                        case "getKiller" -> killer;
                        case "getType" -> EntityType.PILLAGER;
                        default -> throw new AssertionError("Unexpected Raider action: " + method.getName());
                    });
        }
    }

    private static final class RaidState {
        Location at;
        Raid.RaidStatus status = Raid.RaidStatus.ONGOING;
        final Raid proxy;
        RaidState(World world, double x, double y, double z) {
            at = new Location(world, x, y, z);
            proxy = (Raid) Proxy.newProxyInstance(Raid.class.getClassLoader(), new Class<?>[] {Raid.class},
                    (self, method, values) -> switch (method.getName()) {
                        case "getLocation" -> at.clone();
                        case "getStatus" -> status;
                        default -> throw new AssertionError("Unexpected Raid action: " + method.getName());
                    });
        }
    }

    private static final class Person {
        final UUID id = UUID.randomUUID();
        final List<JsonObject> payloads = new ArrayList<>();
        final Player proxy;
        Person(String name) {
            proxy = (Player) Proxy.newProxyInstance(Player.class.getClassLoader(), new Class<?>[] {Player.class},
                    (self, method, values) -> switch (method.getName()) {
                        case "getUniqueId" -> id;
                        case "getGameMode" -> GameMode.SURVIVAL;
                        case "getName" -> name;
                        case "getListeningPluginChannels" -> Set.of(VillageWatchManager.CHANNEL);
                        case "sendPluginMessage" -> { payloads.add(JsonParser.parseString(new String((byte[]) values[2], StandardCharsets.UTF_8)).getAsJsonObject()); yield null; }
                        case "sendMessage" -> null;
                        default -> throw new AssertionError("Unexpected player action: " + method.getName());
                    });
        }
    }

    private static Object identity(Object proxy, String name, Object[] arguments) {
        return switch (name) {
            case "hashCode" -> System.identityHashCode(proxy);
            case "equals" -> proxy == arguments[0];
            default -> throw new AssertionError("Unexpected identity action: " + name);
        };
    }
    private static JsonObject last(Person person) { return person.payloads.get(person.payloads.size() - 1); }
    private static Object snapshot(VillageWatchManager manager) throws Exception { return method("snapshot").invoke(manager); }
    private static Object value(Object record, String methodName) throws Exception {
        Method method = record.getClass().getDeclaredMethod(methodName); method.setAccessible(true); return method.invoke(record);
    }
    private static Method method(String name, Class<?>... parameters) throws Exception {
        Method method = VillageWatchManager.class.getDeclaredMethod(name, parameters); method.setAccessible(true); return method;
    }
    private static Field field(Class<?> type, String name) throws Exception {
        Field field = type.getDeclaredField(name); field.setAccessible(true); return field;
    }
    private static <T> T allocate(Class<T> type) throws Exception {
        Unsafe unsafe = (Unsafe) field(Unsafe.class, "theUnsafe").get(null); return type.cast(unsafe.allocateInstance(type));
    }
    private static void check(boolean valid, String message) { if (!valid) throw new AssertionError(message); }
}
