package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.api.task.IAttackTask;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Predicate;
import local.tlmcompat.core.CompatibilityException;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.ai.memory.MemoryModuleType;
import net.neoforged.neoforge.common.CommonHooks;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.craftbukkit.CraftWorld;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityTeleportEvent;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerPortalEvent;
import org.bukkit.event.player.PlayerTeleportEvent;

/** Move original following companions only after the owner's trip reaches a safe destination. */
final class NativeMaidOwnerTravel implements Listener {
    private static final int LEGACY_RANGE = 16;
    private static final int ARRIVAL_RANGE = 8;

    private record Candidate(UUID id, Location sourceHint) {}

    private record Trip(Player owner, World source, Location destination, boolean portal, int trialStage, List<Candidate> companions) {
        boolean changesWorld() {
            return !source.equals(destination.getWorld());
        }
    }

    private record Correction(Player owner, Location from, Location to, int tick) {}

    private final HybridMaidPlugin plugin;
    private final Map<UUID, Trip> pending = new HashMap<>();
    private final Map<UUID, Trip> arriving = new HashMap<>();
    private final Map<UUID, Correction> corrections = new HashMap<>();

    NativeMaidOwnerTravel(HybridMaidPlugin plugin) {
        this.plugin = plugin;
        Bukkit.getPluginManager().registerEvents(this, plugin);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void catchUpOnJoin(org.bukkit.event.player.PlayerJoinEvent event) {
        Player owner = event.getPlayer();
        var binding = plugin.personal;
        if (binding == null || !binding.owner().equals(owner.getUniqueId())) return;
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            if (Bukkit.getPlayer(binding.owner()) != owner || !canTravel(owner) || pending.containsKey(binding.owner())
                    || !plugin.personalTravel(binding.maid()) || !plugin.registeredMaids().has(binding.maid().toString())) return;
            var body = Bukkit.getEntity(binding.maid());
            Location last = body == null ? NativeMaidLocation.indexed(binding.owner(), binding.maid()) : body.getLocation();
            if (last == null || last.getWorld().equals(owner.getWorld()) || arriving.containsKey(binding.owner())) return;
            Trip trip = new Trip(owner, last.getWorld(), owner.getLocation(), false, 0,
                List.of(new Candidate(binding.maid(), last)));
            pending.put(binding.owner(), trip);
            arrive(trip, trip.destination());
        }, 40);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void portal(PlayerPortalEvent event) {
        depart(event, true);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void teleport(PlayerTeleportEvent event) {
        if (!(event instanceof PlayerPortalEvent)) depart(event, false);
    }

    private void depart(PlayerTeleportEvent event, boolean portal) {
        Player owner = event.getPlayer();
        Location from = event.getFrom();
        Location destination = event.getTo();
        if (destination == null || destination.getWorld() == null || !canTravel(owner)) return;
        boolean changesWorld = !from.getWorld().equals(destination.getWorld());
        UUID ownerId = owner.getUniqueId();
        Trip current = pending.get(ownerId);
        // Youer can report the final position correction with both endpoints
        // in the destination world. Keep the original cross-world departure.
        if (!portal && current != null && current.owner() == owner && current.changesWorld()
                && current.destination().getWorld().equals(destination.getWorld())
                && ((current.portal() && current.source().equals(from.getWorld()))
                    || (!changesWorld && event.getCause() == PlayerTeleportEvent.TeleportCause.UNKNOWN))) return;

        if (!portal && !changesWorld && event.getCause() == PlayerTeleportEvent.TeleportCause.UNKNOWN) {
            Correction correction = new Correction(owner, from.clone(), destination.clone(), Bukkit.getCurrentTick());
            corrections.put(ownerId, correction);
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (corrections.get(ownerId) == correction) corrections.remove(ownerId);
            });
        }
        if (!changesWorld && (portal || from.distanceSquared(destination) < LEGACY_RANGE * LEGACY_RANGE)) return;
        Trip trip = capture(owner, from, destination, portal, 0);
        if (trip == null) return;

        if (trip.changesWorld()) {
            Bukkit.getScheduler().runTaskLater(plugin, () -> {
                if (pending.get(ownerId) == trip) pending.remove(ownerId);
            }, 10);
        } else {
            scheduleArrival(trip, trip.destination());
        }
    }

    private Trip capture(Player owner, Location from, Location destination, boolean portal, int trialStage) {
        return capture(owner, from.getWorld(), from, destination, portal, trialStage);
    }

    private Trip capture(Player owner, World sourceWorld, Location from, Location destination, boolean portal, int trialStage) {
        UUID ownerId = owner.getUniqueId();
        boolean crossWorld = !sourceWorld.equals(destination.getWorld());
        List<Candidate> companions = new ArrayList<>();
        for (var entry : plugin.registeredMaids().entrySet()) {
            var row = entry.getValue().getAsJsonObject();
            if (!ownerId.toString().equals(row.get("ownerId").getAsString())) continue;
            UUID id = UUID.fromString(entry.getKey());
            boolean personal = plugin.personalTravel(id);
            if (from == null && !personal) continue;
            if (personal && crossWorld && Bukkit.getEntity(id) == null) {
                Location indexed = NativeMaidLocation.indexed(ownerId, id);
                if (indexed != null && sourceWorld.equals(indexed.getWorld())) companions.add(new Candidate(id, indexed));
                continue;
            }
            EntityMaid maid = followingMaid(id, ownerId, sourceWorld);
            if (maid == null) continue;
            int range = departureRange(maid);
            Location source = maid.getBukkitEntity().getLocation();
            if (range > 0 && ((personal && crossWorld) || from != null && source.distanceSquared(from) <= range * range)) {
                companions.add(new Candidate(id, personal ? source : null));
            }
        }

        pending.remove(ownerId);
        arriving.remove(ownerId);
        if (companions.isEmpty()) return null;
        Trip trip = new Trip(owner, sourceWorld, destination.clone(), portal, trialStage, List.copyOf(companions));
        pending.put(ownerId, trip);
        return trip;
    }

    void followTrialTransfer(Player owner, Location from, int stage) {
        if (!canTravel(owner) || stage < 1 || !owner.getWorld().equals(from.getWorld())) return;
        Trip trip = capture(owner, from, owner.getLocation(), false, stage);
        if (trip != null) scheduleArrival(trip, trip.destination());
    }

    Location recallLanding(Player owner) {
        if (!canTravel(owner)) {
            throw new CompatibilityException("actor_unavailable", "本人使用存活的游戏角色后再召回伙伴。");
        }
        Location landing = safe(owner.getLocation(), candidate -> true, true);
        if (landing == null) {
            throw new CompatibilityException("no_safe_landing", "请站到附近有实心地面和两格净空的位置，再召回伙伴。");
        }
        return landing;
    }

    boolean recoverFollowing(EntityMaid maid, Player owner) {
        if(!plugin.nativeTravelAllowed(maid.getUUID()))return false;
        Location origin = maid.getBukkitEntity().getLocation();
        Location target = owner.getLocation();
        if (!canTravel(owner) || maid.isSleeping() || maid.isPassenger() || maid.isVehicle()
                || maid.isMaidInSittingPose() || maid.isHomeModeEnable() || maid.isNoAi() || !maid.canBrainMoving()
                || plugin.editingMaidInventory(maid) || plugin.workshops().busy(maid.getUUID())
                || !idleOrAutoDefending(maid)) return false;
        int range;
        try {
            range = NativeMaidFollowSupport.limits(maid).recoverBeyond();
        } catch (IllegalArgumentException invalidProfile) {
            return false;
        }
        boolean combat = plugin.companionCombatPosition(owner, target);
        if (origin.getWorld().equals(target.getWorld()) && origin.distanceSquared(target) <= range * range
                && (!combat || plugin.companionCombatPosition(owner, origin))) return false;
        Location landing = safe(target, candidate -> !combat || plugin.companionCombatPosition(owner, candidate), true);
        if (landing == null || !transfer(maid, landing)) return false;
        EntityMaid arrived = HybridMaidPlugin.nativeMaid(Bukkit.getEntity(maid.getUUID()));
        if (arrived != null) {
            arrived.getBrain().eraseMemory(MemoryModuleType.WALK_TARGET);
            arrived.getBrain().eraseMemory(MemoryModuleType.PATH);
            arrived.getNavigation().stop();
            plugin.rememberResidenceDeparture(arrived);
        }
        return arrived != null;
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void changedWorld(PlayerChangedWorldEvent event) {
        Player owner = event.getPlayer();
        UUID ownerId = owner.getUniqueId();
        Trip trip = pending.get(ownerId);
        Correction correction = corrections.remove(ownerId);
        if (trip != null && trip.owner() == owner && trip.changesWorld()
                && trip.source().equals(event.getFrom()) && trip.destination().getWorld().equals(owner.getWorld())) {
            // The planned Nether portal position is only the exit search origin.
            scheduleArrival(trip, trip.portal() ? owner.getLocation() : trip.destination());
            return;
        }

        // A direct Youer teleport can report the old coordinates in the new world.
        // Accept that sample only with this connection's same-tick world change.
        Location from = null;
        if (correction != null && correction.owner() == owner && correction.tick() == Bukkit.getCurrentTick()
                && correction.to().getWorld().equals(owner.getWorld())) {
            from = correction.from().clone();
            from.setWorld(event.getFrom());
        }
        // A completed world change can arrive without a coordinate correction (e.g. identical x/y/z).
        // Only personal bodies can travel without knowing the owner's departure coordinates.
        Trip direct = capture(owner, event.getFrom(), from, owner.getLocation(), false, 0);
        if (direct != null) scheduleArrival(direct, direct.destination());
    }

    private void scheduleArrival(Trip trip, Location arrival) {
        Bukkit.getScheduler().runTaskLater(plugin, () -> arrive(trip, arrival), 2);
    }

    private void arrive(Trip trip, Location arrival) {
        Player owner = trip.owner();
        UUID ownerId = owner.getUniqueId();
        if (!pending.remove(ownerId, trip)) return;
        if (!canTravel(owner) || Bukkit.getPlayer(ownerId) != owner || !arrival.getWorld().equals(owner.getWorld())) return;
        List<org.bukkit.Chunk> tickets = new ArrayList<>();
        List<UUID> loading = new ArrayList<>();
        try {
            for (var candidate : trip.companions()) {
                if (candidate.sourceHint() == null || Bukkit.getEntity(candidate.id()) != null || !plugin.personalTravel(candidate.id())) continue;
                var ticket = NativeMaidLocation.loadExisting(candidate.sourceHint(), plugin);
                if (ticket != null) tickets.add(ticket);
                loading.add(candidate.id());
            }
            arriving.put(ownerId, trip);
            // On Youer the NBT may be present before the entity is tracked. Retain the exact source
            // chunk across ticks; a new departure or connection invalidates this arrival.
            NativeMaidLocation.whenTracked(plugin, loading,
                () -> arriving.get(ownerId) == trip && Bukkit.getPlayer(ownerId) == owner && owner.getWorld().equals(arrival.getWorld()),
                () -> deliver(trip, arrival, tickets));
        } catch (RuntimeException failed) {
            arriving.remove(ownerId, trip);
            for (var ticket : tickets) NativeMaidLocation.release(ticket, plugin);
            throw failed;
        }
    }

    private void deliver(Trip trip, Location arrival, List<org.bukkit.Chunk> tickets) {
        Player owner = trip.owner();
        UUID ownerId = owner.getUniqueId();
        try {
            if (!arriving.remove(ownerId, trip) || !canTravel(owner) || Bukkit.getPlayer(ownerId) != owner
                    || !arrival.getWorld().equals(owner.getWorld())) return;
            Location current = owner.getLocation();
            boolean leftArrival = current.distanceSquared(arrival) > ARRIVAL_RANGE * ARRIVAL_RANGE;
            if (trip.trialStage() > 0 && !trialArrival(owner, trip.trialStage(), current)) return;
            for (var candidate : trip.companions()) {
                UUID id = candidate.id();
                if (leftArrival && !plugin.personalTravel(id)) continue;
                EntityMaid maid = followingMaid(id, ownerId, trip.source());
                if (maid == null || (trip.source().equals(owner.getWorld())
                        && maid.getBukkitEntity().getLocation().distanceSquared(current) < 16)) continue;
                Location landing = trip.trialStage() > 0
                    ? safe(current, spot -> trialArrival(owner, trip.trialStage(), spot), true) : safe(current, spot -> true, plugin.personalTravel(id));
                if (landing == null) {
                    owner.sendMessage("[女仆·随行] 附近没有安全落点。请站到有实心地面和两格净空的地方，再用 /qdmaid recall 召回。");
                    continue;
                }
                if (!transfer(maid, landing)) {
                    owner.sendMessage("[女仆·随行] 尚未确认伙伴到达。请用 /qdmaid list 查看原女仆，再用 /qdmaid recall 召回。");
                }
            }
        } finally {
            for (var ticket : tickets) NativeMaidLocation.release(ticket, plugin);
            tickets.clear();
        }
    }

    boolean transfer(EntityMaid maid, Location landing) {
        var entity = maid.getBukkitEntity();
        if (entity.getWorld().equals(landing.getWorld())) {
            return entity.teleport(landing, PlayerTeleportEvent.TeleportCause.PLUGIN);
        }

        ServerLevel source = (ServerLevel) maid.level();
        ServerLevel destination = ((CraftWorld) landing.getWorld()).getHandle();
        UUID id = maid.getUUID();
        if (maid.isVehicle() || destination.getEntity(id) != null) return false;
        var event = new EntityTeleportEvent(entity, entity.getLocation(), landing.clone());
        if (!event.callEvent() || !landing.equals(event.getTo())
                || !CommonHooks.onTravelToDimension(maid, destination.dimension())) return false;
        if (source.getEntity(id) != maid || !maid.isAlive() || maid.isRemoved() || destination.getEntity(id) != null) return false;

        // TLM overrides changeDimension and declines Bukkit's usual transfer.
        // Use the native /tp transfer and verify that the same UUID was installed.
        try {
            maid.teleportTo(destination, landing.getX(), landing.getY(), landing.getZ(), Set.of(),
                    landing.getYaw(), landing.getPitch());
            if (!(destination.getEntity(id) instanceof EntityMaid arrived) || !arrived.isAlive()
                    || !maid.getOwnerUUID().equals(arrived.getOwnerUUID())) return false;
            // Give the transferred maid the same protection against immediate portal re-entry.
            arrived.setPortalCooldown();
            return true;
        } finally {
            if (destination.getEntity(id) == null) {
                var loaded = Bukkit.getEntity(id);
                if (loaded == null || source.getEntity(id) == maid) {
                    // Native restoreFrom retargets the existing Bukkit wrapper before registration.
                    entity.setHandle(maid);
                }
                var removal = maid.getRemovalReason();
                if (loaded == null && removal != null && !removal.shouldDestroy() && !removal.shouldSave()) {
                    // The destination rejected registration after native removal from the source.
                    maid.revive();
                    source.addDuringTeleport(maid);
                    if (source.getEntity(id) != maid) {
                        plugin.getLogger().severe("Maid travel source registration rejected for " + id);
                    }
                }
            }
        }
    }

    private static boolean canTravel(Player owner) {
        return owner.isOnline() && !owner.isDead() && owner.getGameMode() != GameMode.SPECTATOR;
    }

    private EntityMaid followingMaid(UUID id, UUID ownerId, World source) {
        if(!plugin.nativeTravelAllowed(id))return null;
        EntityMaid maid = HybridMaidPlugin.nativeMaid(Bukkit.getEntity(id));
        boolean personal = plugin.personalTravel(id);
        if (maid == null || !ownerId.equals(maid.getOwnerUUID()) || !source.equals(maid.getBukkitEntity().getWorld())
                || (!personal && !plugin.sharedDialogueEnabled(maid)) || !maid.isAlive() || maid.isRemoved() || maid.isNoAi()
                || maid.isSleeping()) return null;
        if (personal && (maid.isPassenger() || maid.isVehicle() || plugin.editingMaidInventory(maid)
                || plugin.workshops().busy(id))) return null;
        boolean idle = maid.getTask().getUid().toString().equals("touhou_little_maid:idle");
        // Model-selected short waiting is still companionship, not permanent stationing.
        // Keep the lease and original identity across an accepted partner departure.
        // Native following resumes on expiry in the arrival world.
        boolean temporaryWait = idle && MaidCompanionActions.waiting(maid)
                && maid.isMaidInSittingPose() && maid.isHomeModeEnable() && !maid.isPassenger() && !maid.isVehicle();
        if (!temporaryWait && (maid.isMaidInSittingPose() || maid.isHomeModeEnable() || !maid.canBrainMoving())) return null;
        return idleOrAutoDefending(maid) || (personal && maid.getTask() instanceof IAttackTask) ? maid : null;
    }

    private static boolean idleOrAutoDefending(EntityMaid maid) {
        String task = maid.getTask().getUid().toString();
        return task.equals(MaidCompanionActions.IDLE)
            || task.equals(maid.getPersistentData().getString("qiandengji_auto_defence_task"));
    }

    private static int departureRange(EntityMaid maid) {
        try {
            return Math.max(LEGACY_RANGE, NativeMaidFollowSupport.limits(maid).walkBeyond());
        } catch (IllegalArgumentException invalidProfile) {
            return 0;
        }
    }

    private static boolean trialArrival(Player owner, int stage, Location landing) {
        var agentFriend = Bukkit.getPluginManager().getPlugin("AgentFriend");
        if (agentFriend == null || !agentFriend.isEnabled()) return false;
        try {
            Class<?> access = Class.forName("org.afuhome.agentfriend.CompanionTravelAccess", false, agentFriend.getClass().getClassLoader());
            return Boolean.TRUE.equals(access.getMethod("trialArrival", Player.class, int.class, Location.class)
                .invoke(null, owner, stage, landing));
        } catch (ReflectiveOperationException | LinkageError unavailable) { return false; }
    }

    static Location safe(Location centre){
        return safe(centre, candidate -> true);
    }
    private static Location safe(Location centre, Predicate<Location> allowed){
        return safe(centre, allowed, false);
    }
    private static Location safe(Location centre, Predicate<Location> allowed, boolean fallbackToOwner) {
        World world=centre.getWorld();
        int[][] offsets = {{1,0},{-1,0},{0,1},{0,-1},{1,1},{-1,-1},{1,-1},{-1,1}};
        for (int dy : new int[]{0,1,-1,2}) {
            for (int[] offset : offsets) {
                Location at = new Location(world, centre.getBlockX()+offset[0]+.5, centre.getBlockY()+dy,
                    centre.getBlockZ()+offset[1]+.5, centre.getYaw(), 0);
                if (safeBlock(at) && allowed.test(at)) return at;
            }
        }
        if (!fallbackToOwner) return null;
        Location ownerBlock = new Location(world, centre.getBlockX()+.5, centre.getBlockY(), centre.getBlockZ()+.5,
            centre.getYaw(), 0);
        return safeBlock(ownerBlock) && allowed.test(ownerBlock) ? ownerBlock : null;
    }

    static boolean safeBlock(Location at) {
        World world = at.getWorld();
        int x = at.getBlockX(), y = at.getBlockY(), z = at.getBlockZ();
        if (y <= world.getMinHeight() || y + 1 >= world.getMaxHeight()
                || !world.isChunkLoaded(x >> 4, z >> 4) || !world.getWorldBorder().isInside(at)) return false;
        Material floor = world.getBlockAt(x, y - 1, z).getType();
        return floor.isSolid() && floor.isOccluding() && world.getBlockAt(x,y,z).getType().isAir()
            && world.getBlockAt(x,y+1,z).getType().isAir()
            && !Set.of(Material.MAGMA_BLOCK,Material.CACTUS,Material.CAMPFIRE,Material.SOUL_CAMPFIRE).contains(floor);
    }
}
