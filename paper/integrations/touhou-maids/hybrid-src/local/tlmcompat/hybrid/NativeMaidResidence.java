package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.Tag;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.ai.memory.MemoryModuleType;
import net.minecraft.world.entity.ai.behavior.BlockPosTracker;
import net.minecraft.world.level.pathfinder.Path;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Particle;
import org.bukkit.World;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.world.WorldSaveEvent;

/** The original companion can patrol one configured chunk without a connected owner. */
final class NativeMaidResidence implements AutoCloseable, Listener {
    private static final String MARKER = "qiandengji_residence_schedule";
    private static final long SECOND = 1_000_000_000L;
    private static final int REJOIN_DISTANCE = 24;
    private static final int MAX_SOURCE_TICKET_SECONDS = 12;

    private record Config(UUID maid, UUID owner, NamespacedKey world, List<BlockPos> route) {
        BlockPos home() { return route.getFirst(); }
    }

    private record HeldChunk(World world, int x, int z, boolean owned) {
        void release(HybridMaidPlugin plugin) {
            if (owned) world.removePluginChunkTicket(x, z, plugin);
        }
    }

    private final HybridMaidPlugin plugin;
    private final NativeMaidOwnerTravel travel;
    private final Config config;
    private HeldChunk homeChunk;
    private HeldChunk sourceChunk;
    private boolean sourceTried;
    private long sourceDeadline;
    private long originalDeadline;
    private long nextAttempt;
    private long nextLeg;
    private long legDeadline;
    private long nextGreeting;
    private int waypoint;
    private int visits;
    private Path patrolPath;
    private String state = "awaiting_original";

    static NativeMaidResidence open(HybridMaidPlugin plugin, NativeMaidOwnerTravel travel) {
        var path = plugin.getDataFolder().toPath().resolve("residence.json");
        if (!Files.isRegularFile(path)) return null;
        try {
            JsonObject root = JsonParser.parseString(Files.readString(path)).getAsJsonObject();
            if (root.get("schema").getAsInt() != 1) throw new IllegalArgumentException("schema");
            UUID maid = UUID.fromString(root.get("maidId").getAsString());
            UUID owner = UUID.fromString(root.get("ownerId").getAsString());
            NamespacedKey world = NamespacedKey.fromString(root.get("dimension").getAsString());
            JsonArray points = root.getAsJsonArray("route");
            if (world == null || points.size() < 2 || points.size() > 6) throw new IllegalArgumentException("route");
            List<BlockPos> route = new ArrayList<>();
            for (var value : points) {
                JsonArray xyz = value.getAsJsonArray();
                if (xyz.size() != 3) throw new IllegalArgumentException("point");
                var pos = new BlockPos(xyz.get(0).getAsBigDecimal().intValueExact(),
                    xyz.get(1).getAsBigDecimal().intValueExact(), xyz.get(2).getAsBigDecimal().intValueExact());
                if (route.contains(pos)) throw new IllegalArgumentException("duplicate point");
                route.add(pos);
            }
            BlockPos home = route.getFirst();
            for (BlockPos pos : route) {
                if ((pos.getX() >> 4) != (home.getX() >> 4) || (pos.getZ() >> 4) != (home.getZ() >> 4)
                    || !pos.closerThan(home, 8)) throw new IllegalArgumentException("route outside residence");
            }
            return new NativeMaidResidence(plugin, travel, new Config(maid, owner, world, List.copyOf(route)));
        } catch (Exception invalid) {
            plugin.getLogger().warning("Maid residence disabled: invalid residence.json (" + invalid.getClass().getSimpleName() + ")");
            return null;
        }
    }

    private NativeMaidResidence(HybridMaidPlugin plugin, NativeMaidOwnerTravel travel, Config config) {
        this.plugin = plugin;
        this.travel = travel;
        this.config = config;
        Bukkit.getPluginManager().registerEvents(this, plugin);
        Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 40L, 20L);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void quit(PlayerQuitEvent event) {
        if (!config.owner().equals(event.getPlayer().getUniqueId()) || !registered()) return;
        EntityMaid maid = original();
        if (maid != null) plugin.rememberResidenceDeparture(maid);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void save(WorldSaveEvent event) {
        if (!registered()) return;
        EntityMaid maid = original();
        if (maid != null && event.getWorld().equals(maid.getBukkitEntity().getWorld())) plugin.rememberResidenceDeparture(maid);
    }

    private boolean registered() {
        var record = plugin.registeredMaids().get(config.maid().toString());
        return record instanceof JsonObject row && row.has("ownerId")
            && config.owner().toString().equals(row.get("ownerId").getAsString());
    }

    private EntityMaid original() {
        EntityMaid maid = HybridMaidPlugin.nativeMaid(Bukkit.getEntity(config.maid()));
        return maid != null && config.owner().equals(maid.getOwnerUUID()) && maid.isAlive() && !maid.isRemoved()
            && maid.getBukkitEntity().isValid() ? maid : null;
    }

    private static boolean resident(EntityMaid maid) {
        return maid.getPersistentData().contains(MARKER, Tag.TAG_COMPOUND);
    }

    private static boolean playable(Player player) {
        return player != null && player.isOnline() && !player.isDead() && !player.isInvisible()
            && player.getGameMode() != GameMode.SPECTATOR;
    }

    private void tick() {
        if (!registered()) {
            state = "binding_unavailable";
            releaseSource();
            releaseHome();
            return;
        }
        long now = System.nanoTime();
        if (sourceChunk != null && now >= sourceDeadline) releaseSource();
        EntityMaid maid = original();
        Player partner = Bukkit.getPlayer(config.owner());
        if (partner != null && maid != null && !resident(maid)) {
            state = "partner_online";
            sourceTried = false;
            releaseSource();
            releaseHome();
            return;
        }
        if (maid == null && homeChunk == null && sourceTried) return;
        if (maid != null) {
            if (!resident(maid) && !eligible(maid)) {
                state = "manual_mode";
                releaseSource();
                releaseHome();
                return;
            }
        }
        World world = Bukkit.getWorld(config.world());
        if (world == null || now < nextAttempt) return;
        if (homeChunk == null) {
            homeChunk = hold(world, config.home().getX() >> 4, config.home().getZ() >> 4);
            if (homeChunk == null) {
                state = "home_unavailable";
                nextAttempt = now + 30 * SECOND;
            } else {
                originalDeadline = now + MAX_SOURCE_TICKET_SECONDS * SECOND;
            }
            return;
        }
        if (maid == null) {
            state = "awaiting_original";
            if (!sourceTried) {
                sourceTried = true;
                findOriginal(now);
            }
            if (sourceChunk == null && now >= originalDeadline) {
                releaseHome();
            }
            return;
        }
        if (!resident(maid)) {
            if (partner == null) returnHome(maid, world, now);
            return;
        }
        if (playable(partner) && near(partner, world, config.home(), REJOIN_DISTANCE)) {
            releasePatrol(maid);
            restoreSchedule(maid);
            MaidCompanionActions.follow(maid);
            state = "partner_online";
            sourceTried = false;
            releaseHome();
            return;
        }
        state = partner == null ? "resident_patrol" : "awaiting_partner_at_home";
        patrol(maid, world, now);
    }

    private boolean eligible(EntityMaid maid) {
        return !maid.isHomeModeEnable() && !maid.isMaidInSittingPose() && !maid.isSleeping()
            && !maid.isPassenger() && !maid.isVehicle() && !maid.isNoAi() && maid.canBrainMoving()
            && MaidCompanionActions.IDLE.equals(maid.getTask().getUid().toString()) && maid.getTarget() == null
            && !plugin.workshops().busy(config.maid());
    }

    private HeldChunk hold(World world, int x, int z) {
        try {
            if (!world.isChunkLoaded(x, z) && (!world.isChunkGenerated(x, z) || !world.loadChunk(x, z, false))) return null;
            return new HeldChunk(world, x, z, world.addPluginChunkTicket(x, z, plugin));
        } catch (RuntimeException error) {
            plugin.getLogger().warning("Maid residence chunk unavailable: " + error.getClass().getSimpleName());
            return null;
        }
    }

    private void findOriginal(long now) {
        JsonObject last = plugin.lastResidenceLocation(config.owner(), config.maid());
        if (last == null) return;
        World source = Bukkit.getWorld(NamespacedKey.fromString(last.get("dimension").getAsString()));
        if (source == null) return;
        JsonArray xyz = last.getAsJsonArray("position");
        var pos = BlockPos.containing(xyz.get(0).getAsDouble(), xyz.get(1).getAsDouble(), xyz.get(2).getAsDouble());
        int x = pos.getX() >> 4, z = pos.getZ() >> 4;
        if (source.equals(homeChunk.world()) && x == homeChunk.x() && z == homeChunk.z()) return;
        sourceChunk = hold(source, x, z);
        sourceDeadline = now + MAX_SOURCE_TICKET_SECONDS * SECOND;
    }

    private void returnHome(EntityMaid maid, World world, long now) {
        Location landing = location(world, config.home());
        if (!walkable(world, config.home()) || !travel.transfer(maid, landing)) {
            state = "home_landing_unavailable";
            nextAttempt = now + 15 * SECOND;
            return;
        }
        EntityMaid arrived = original();
        if (arrived == null || !near(arrived.getBukkitEntity(), world, config.home(), 1)) return;
        releaseSource();
        arrived.getNavigation().stop();
        arrived.getBrain().eraseMemory(MemoryModuleType.WALK_TARGET);
        arrived.getBrain().eraseMemory(MemoryModuleType.PATH);
        var saved = new CompoundTag();
        arrived.getSchedulePos().save(saved);
        arrived.getPersistentData().put(MARKER, saved);
        arrived.setHomeModeEnable(true);
        arrived.getSchedulePos().setHomeModeEnable(arrived, config.home());
        waypoint = 1;
        nextLeg = 0;
        legDeadline = 0;
    }

    private static void restoreSchedule(EntityMaid maid) {
        var data = maid.getPersistentData();
        if (!data.contains(MARKER, Tag.TAG_COMPOUND)) return;
        maid.getSchedulePos().load(data.getCompound(MARKER), maid);
        data.remove(MARKER);
    }

    void manual(EntityMaid maid) {
        if (!config.maid().equals(maid.getUUID()) || !resident(maid)) return;
        releasePatrol(maid);
        restoreSchedule(maid);
        maid.setHomeModeEnable(false);
        releaseHome();
    }

    private void patrol(EntityMaid maid, World world, long now) {
        if (!maid.isHomeModeEnable() || !near(maid.getBukkitEntity(), world, config.home(), 14)
            || !maid.canBrainMoving() || maid.isSleeping() || maid.isMaidInSittingPose() || maid.isPassenger()
            || maid.getTarget() != null || !MaidCompanionActions.IDLE.equals(maid.getTask().getUid().toString())) {
            releasePatrol(maid);
            return;
        }
        if (now >= nextGreeting && greet(maid, now)) return;
        if (now < nextLeg) return;
        BlockPos target = config.route().get(waypoint);
        if (near(maid.getBukkitEntity(), world, target, 0.85)) {
            visits++;
            advance(maid, now);
            return;
        }
        if (legDeadline != 0 && now >= legDeadline) {
            advance(maid, now);
            return;
        }
        var navigation = maid.getNavigation();
        var brain = maid.getBrain();
        var existing = brain.getMemory(MemoryModuleType.WALK_TARGET).orElse(null);
        if (existing != null) {
            // While idle at the residence, native random walks may leave a stale
            // block target. Yield to entity targets and to any path still moving.
            if (!(existing.getTarget() instanceof BlockPosTracker) || !navigation.isDone()) return;
            brain.eraseMemory(MemoryModuleType.WALK_TARGET);
            brain.eraseMemory(MemoryModuleType.PATH);
            brain.eraseMemory(MemoryModuleType.CANT_REACH_WALK_TARGET_SINCE);
        }
        if (navigation.getPath() != null && !navigation.isDone()) return;
        var path = walkable(world, target) ? navigation.createPath(target, 0) : null;
        if (path == null || !path.canReach() || !inResidence(path) || !navigation.moveTo(path, 0.65)) {
            advance(maid, now);
            return;
        }
        patrolPath = navigation.getPath();
        if (legDeadline == 0) legDeadline = now + 10 * SECOND;
    }

    private boolean inResidence(Path path) {
        for (int i = 0; i < path.getNodeCount(); i++) {
            BlockPos pos = path.getNode(i).asBlockPos();
            if ((pos.getX() >> 4) != (config.home().getX() >> 4)
                || (pos.getZ() >> 4) != (config.home().getZ() >> 4)) return false;
        }
        return true;
    }

    private void advance(EntityMaid maid, long now) {
        releasePatrol(maid);
        waypoint = (waypoint + 1) % config.route().size();
        legDeadline = 0;
        nextLeg = now + 2 * SECOND;
    }

    private boolean greet(EntityMaid maid, long now) {
        var entity = maid.getBukkitEntity();
        Player guest = entity.getLocation().getNearbyPlayers(6).stream()
            .filter(player -> playable(player) && player.canSee(entity) && player.hasLineOfSight(entity))
            .min(Comparator.comparingDouble(player -> player.getLocation().distanceSquared(entity.getLocation())))
            .orElse(null);
        if (!(guest instanceof CraftPlayer craft)) return false;
        releasePatrol(maid);
        maid.getLookControl().setLookAt(craft.getHandle(), 40, 40);
        maid.swing(InteractionHand.MAIN_HAND);
        entity.getWorld().spawnParticle(Particle.HAPPY_VILLAGER, entity.getLocation().add(0, 1.5, 0), 3, 0.2, 0.15, 0.2, 0);
        nextGreeting = now + 40 * SECOND;
        nextLeg = now + 2 * SECOND;
        return true;
    }

    private static Location location(World world, BlockPos pos) {
        return new Location(world, pos.getX() + 0.5, pos.getY(), pos.getZ() + 0.5);
    }

    private static boolean near(org.bukkit.entity.Entity entity, World world, BlockPos pos, double radius) {
        return entity.getWorld().equals(world) && entity.getLocation().distanceSquared(location(world, pos)) <= radius * radius;
    }

    private static boolean walkable(World world, BlockPos pos) {
        int x = pos.getX(), y = pos.getY(), z = pos.getZ();
        if (y <= world.getMinHeight() || y + 1 >= world.getMaxHeight() || !world.isChunkLoaded(x >> 4, z >> 4)
            || !world.getWorldBorder().isInside(location(world, pos))) return false;
        Material floor = world.getBlockAt(x, y - 1, z).getType();
        return floor.isSolid() && floor.isOccluding() && floor != Material.MAGMA_BLOCK && floor != Material.CACTUS
            && floor != Material.CAMPFIRE && floor != Material.SOUL_CAMPFIRE
            && world.getBlockAt(x, y, z).getType().isAir() && world.getBlockAt(x, y + 1, z).getType().isAir();
    }

    private void releasePatrol(EntityMaid maid) {
        if (patrolPath != null && maid.getNavigation().getPath() == patrolPath) maid.getNavigation().stop();
        patrolPath = null;
    }

    void describe(UUID maid, JsonObject data) {
        if (!config.maid().equals(maid)) return;
        var out = new JsonObject();
        out.addProperty("state", state);
        out.addProperty("dimension", config.world().toString());
        var home = new JsonArray();
        home.add(config.home().getX());
        home.add(config.home().getY());
        home.add(config.home().getZ());
        out.add("home", home);
        out.addProperty("patrolVisitsThisRun", visits);
        out.addProperty("rejoinDistance", REJOIN_DISTANCE);
        World world = Bukkit.getWorld(config.world());
        out.addProperty("holdingResidenceChunk", world != null && world.getPluginChunkTickets(
            config.home().getX() >> 4, config.home().getZ() >> 4).contains(plugin));
        data.add("residence", out);
    }

    private void releaseHome() {
        if (homeChunk != null) homeChunk.release(plugin);
        homeChunk = null;
    }

    private void releaseSource() {
        if (sourceChunk != null) sourceChunk.release(plugin);
        sourceChunk = null;
    }

    @Override public void close() {
        EntityMaid maid = original();
        if (maid != null) releasePatrol(maid);
        releaseSource();
        releaseHome();
    }
}
