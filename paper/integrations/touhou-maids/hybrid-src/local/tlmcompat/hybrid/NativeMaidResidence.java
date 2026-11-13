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
import java.util.function.Consumer;
import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.Tag;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.ai.memory.MemoryModuleType;
import net.minecraft.world.entity.ai.memory.WalkTarget;
import net.minecraft.world.entity.schedule.Activity;
import net.minecraft.world.level.pathfinder.Path;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.tick.EntityTickEvent;
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
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.world.WorldSaveEvent;

/** The original companion can patrol one configured chunk without a connected owner. */
final class NativeMaidResidence implements AutoCloseable, Listener {
    private static final String MARKER = "qiandengji_residence_schedule";
    private static final long SECOND = 1_000_000_000L;
    private static final int REJOIN_DISTANCE = 24;
    private static final long REUNION_RETRY = 15 * SECOND;
    private static final int MAX_SOURCE_TICKET_SECONDS = 12;
    private static final long RECONNECT_GRACE = 90 * SECOND;

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
    private long nextReunionAttempt;
    private long offlineSince = System.nanoTime();
    private long nextLeg;
    private long legDeadline;
    private long nextGreeting;
    private int waypoint;
    private int visits;
    private WalkTarget patrolWalk;
    private Path checkedPath;
    private Path priorNativePath;
    private EntityMaid stationedBody;
    private final Consumer<EntityTickEvent.Pre> beforeMaidTick = this::beforeMaidTick;
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
        NeoForge.EVENT_BUS.addListener(beforeMaidTick);
        Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 40L, 20L);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void quit(PlayerQuitEvent event) {
        if (!config.owner().equals(event.getPlayer().getUniqueId()) || !registered()) return;
        offlineSince = System.nanoTime();
        EntityMaid maid = original();
        if (maid != null) plugin.rememberResidenceDeparture(maid);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void join(PlayerJoinEvent event) {
        if (!config.owner().equals(event.getPlayer().getUniqueId())) return;
        sourceTried = false;
        nextAttempt = 0;
        nextReunionAttempt = 0;
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
            if (playable(partner) && available(maid) && !maid.isHomeModeEnable() && now >= nextReunionAttempt) {
                nextReunionAttempt = now + REUNION_RETRY;
                travel.recoverFollowing(maid, partner);
            }
            state = "partner_online";
            sourceTried = false;
            releaseSource();
            releaseHome();
            return;
        }
        if (partner == null && (maid == null || !resident(maid)) && now - offlineSince < RECONNECT_GRACE) return;
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
        if (playable(partner) && available(maid)) {
            if (reunite(maid, partner, now)) return;
            state = "awaiting_safe_reunion";
        } else {
            state = partner == null ? "resident_patrol" : "awaiting_partner_at_home";
        }
        if (stationedBody != maid) {
            configureResidenceSchedule(maid);
            stationedBody = maid;
        }
        patrol(maid, world, now);
    }

    private boolean reunite(EntityMaid maid, Player partner, long now) {
        if (now < nextReunionAttempt) return false;
        nextReunionAttempt = now + REUNION_RETRY;
        Location current = maid.getBukkitEntity().getLocation();
        Location target = partner.getLocation();
        EntityMaid arrived = maid;
        try {
            NativeMaidFollowSupport.limits(maid);
            if (!current.getWorld().equals(target.getWorld()) || current.distanceSquared(target) > REJOIN_DISTANCE * REJOIN_DISTANCE) {
                Location landing = travel.recallLanding(partner);
                if (!travel.transfer(maid, landing)) return false;
                arrived = original();
                if (arrived == null || !near(arrived.getBukkitEntity(), landing.getWorld(),
                        BlockPos.containing(landing.getX(), landing.getY(), landing.getZ()), 1)) return false;
            }
        } catch (local.tlmcompat.core.CompatibilityException | IllegalArgumentException unavailable) {
            return false;
        }
        releasePatrol(arrived);
        restoreSchedule(arrived);
        MaidCompanionActions.follow(arrived);
        plugin.rememberResidenceDeparture(arrived);
        state = "partner_online";
        sourceTried = false;
        nextReunionAttempt = 0;
        releaseSource();
        releaseHome();
        return true;
    }

    private boolean eligible(EntityMaid maid) {
        return !maid.isHomeModeEnable() && available(maid);
    }

    private boolean available(EntityMaid maid) {
        return !maid.isMaidInSittingPose() && !maid.isSleeping() && !maid.guiOpening
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
        EntityMaid arrived = transferHome(maid, world, now);
        if (arrived == null) return;
        var saved = new CompoundTag();
        arrived.getSchedulePos().save(saved);
        arrived.getPersistentData().put(MARKER, saved);
        arrived.setHomeModeEnable(true);
        configureResidenceSchedule(arrived);
        stationedBody = arrived;
    }

    private void configureResidenceSchedule(EntityMaid maid) {
        var schedule = maid.getSchedulePos();
        schedule.setWorkPos(config.home());
        schedule.setIdlePos(config.home());
        schedule.setSleepPos(config.home());
        schedule.setDimension(ResourceLocation.parse(config.world().toString()));
        schedule.restrictTo(maid);
    }

    private EntityMaid transferHome(EntityMaid maid, World world, long now) {
        Location landing = location(world, config.home());
        if (!walkable(world, config.home()) || !travel.transfer(maid, landing)) {
            state = "home_landing_unavailable";
            nextAttempt = now + 15 * SECOND;
            return null;
        }
        EntityMaid arrived = original();
        if (arrived == null || !near(arrived.getBukkitEntity(), world, config.home(), 1)) return null;
        releaseSource();
        arrived.getNavigation().stop();
        arrived.getBrain().eraseMemory(MemoryModuleType.WALK_TARGET);
        arrived.getBrain().eraseMemory(MemoryModuleType.PATH);
        patrolWalk = null;
        checkedPath = null;
        priorNativePath = null;
        waypoint = 1;
        nextLeg = 0;
        legDeadline = 0;
        return arrived;
    }

    private void restoreSchedule(EntityMaid maid) {
        var data = maid.getPersistentData();
        if (!data.contains(MARKER, Tag.TAG_COMPOUND)) return;
        maid.getSchedulePos().load(data.getCompound(MARKER), maid);
        data.remove(MARKER);
        stationedBody = null;
    }

    void manual(EntityMaid maid) {
        if (!config.maid().equals(maid.getUUID()) || !resident(maid)) return;
        releasePatrol(maid);
        restoreSchedule(maid);
        maid.setHomeModeEnable(false);
        releaseHome();
    }

    private boolean canPatrol(EntityMaid maid) {
        return maid.isHomeModeEnable() && !maid.isNoAi() && !maid.guiOpening && maid.canBrainMoving() && !maid.isVehicle()
            && !maid.getSwimManager().isGoingToBreath() && !maid.isBegging() && !maid.getBrain().isActive(Activity.PANIC)
            && maid.getScheduleDetail() != Activity.REST && maid.getTarget() == null
            && MaidCompanionActions.IDLE.equals(maid.getTask().getUid().toString())
            && !plugin.workshops().busy(config.maid());
    }

    private void beforeMaidTick(EntityTickEvent.Pre event) {
        if (!(event.getEntity() instanceof EntityMaid maid) || maid.level().isClientSide() || !maid.isAlive() || maid.isRemoved()
            || !config.maid().equals(maid.getUUID()) || !config.owner().equals(maid.getOwnerUUID())
            || !resident(maid) || !canPatrol(maid)) return;
        var brain = maid.getBrain();
        var navigation = maid.getNavigation();
        // Native random strolls can enqueue movement between scheduler runs.
        // Keep one approved destination while the resident is available to patrol.
        var walk = brain.getMemory(MemoryModuleType.WALK_TARGET).orElse(null);
        if (walk != null && walk != patrolWalk) brain.eraseMemory(MemoryModuleType.WALK_TARGET);
        Path current = navigation.getPath();
        if (current == null || current == checkedPath) return;
        if (patrolWalk != null && walk == patrolWalk && current != priorNativePath
            && current.getTarget().equals(patrolWalk.getTarget().currentBlockPosition()) && inResidence(current)) {
            checkedPath = current;
            return;
        }
        navigation.stop();
        brain.eraseMemory(MemoryModuleType.PATH);
    }

    private void patrol(EntityMaid maid, World world, long now) {
        if (!canPatrol(maid)) {
            releasePatrol(maid);
            return;
        }
        if (maid.isInWater()) {
            transferHome(maid, world, now);
            return;
        }
        if (!maid.getBukkitEntity().getWorld().equals(world) || !withinResidence(maid.blockPosition())) {
            transferHome(maid, world, now);
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
        if (patrolWalk != null && brain.getMemory(MemoryModuleType.WALK_TARGET).orElse(null) == patrolWalk) return;
        var path = walkable(world, target) ? navigation.createPath(target, 0) : null;
        if (path == null || !path.canReach() || !inResidence(path)) {
            advance(maid, now);
            return;
        }
        priorNativePath = navigation.getPath();
        patrolWalk = new WalkTarget(target, 0.65F, 0);
        brain.setMemory(MemoryModuleType.WALK_TARGET, patrolWalk);
        if (legDeadline == 0) legDeadline = now + 10 * SECOND;
    }

    private boolean withinResidence(BlockPos pos) {
        BlockPos home = config.home();
        return (pos.getX() >> 4) == (home.getX() >> 4) && (pos.getZ() >> 4) == (home.getZ() >> 4)
            && pos.closerThan(home, 10);
    }

    private boolean inResidence(Path path) {
        for (int i = 0; i < path.getNodeCount(); i++) {
            if (!withinResidence(path.getNode(i).asBlockPos())) return false;
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
        var brain = maid.getBrain();
        if (patrolWalk != null && brain.getMemory(MemoryModuleType.WALK_TARGET).orElse(null) == patrolWalk) {
            brain.eraseMemory(MemoryModuleType.WALK_TARGET);
            brain.eraseMemory(MemoryModuleType.PATH);
        }
        if (checkedPath != null && maid.getNavigation().getPath() == checkedPath) maid.getNavigation().stop();
        patrolWalk = null;
        checkedPath = null;
        priorNativePath = null;
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
        if (state.equals("awaiting_safe_reunion")) {
            out.addProperty("nextStep", "女仆会自动寻找你附近的安全落点，支持跨维度和副本。也可用 /qdmaid recall 主动召回。");
        }
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
        NeoForge.EVENT_BUS.unregister(beforeMaidTick);
        EntityMaid maid = original();
        if (maid != null) releasePatrol(maid);
        releaseSource();
        releaseHome();
    }
}
