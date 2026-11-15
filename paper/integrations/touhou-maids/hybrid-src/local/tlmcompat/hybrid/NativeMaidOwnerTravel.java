package local.tlmcompat.hybrid;

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

/** Follow an accepted owner trip using only loaded entities and safe loaded destinations. */
final class NativeMaidOwnerTravel implements Listener {
    private static final int LEGACY_RANGE = 16;
    private static final int ARRIVAL_RANGE = 8;

    private record Trip(Player owner, World source, Location destination, boolean portal, int trialStage, List<UUID> companions) {
        boolean changesWorld() {
            return !source.equals(destination.getWorld());
        }
    }

    private record Correction(Player owner, Location from, Location to, int tick) {}

    private final HybridMaidPlugin plugin;
    private final Map<UUID, Trip> pending = new HashMap<>();
    private final Map<UUID, Correction> corrections = new HashMap<>();

    NativeMaidOwnerTravel(HybridMaidPlugin plugin) {
        this.plugin = plugin;
        Bukkit.getPluginManager().registerEvents(this, plugin);
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
        UUID ownerId = owner.getUniqueId();
        List<UUID> companions = new ArrayList<>();
        for (String key : plugin.registeredMaids().keySet()) {
            EntityMaid maid = followingMaid(UUID.fromString(key), ownerId, from.getWorld());
            if (maid == null) continue;
            int range = departureRange(maid);
            if (range > 0 && maid.getBukkitEntity().getLocation().distanceSquared(from) <= range * range) {
                companions.add(maid.getUUID());
            }
        }

        pending.remove(ownerId);
        if (companions.isEmpty()) return null;
        Trip trip = new Trip(owner, from.getWorld(), destination.clone(), portal, trialStage, List.copyOf(companions));
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
        if (correction == null || correction.owner() != owner || correction.tick() != Bukkit.getCurrentTick()
                || !correction.to().getWorld().equals(owner.getWorld())) return;
        Location from = correction.from().clone();
        from.setWorld(event.getFrom());
        Trip direct = capture(owner, from, correction.to(), false, 0);
        if (direct != null) scheduleArrival(direct, direct.destination());
    }

    private void scheduleArrival(Trip trip, Location arrival) {
        Bukkit.getScheduler().runTaskLater(plugin, () -> arrive(trip, arrival), 2);
    }

    private void arrive(Trip trip, Location arrival) {
        Player owner = trip.owner();
        UUID ownerId = owner.getUniqueId();
        if (pending.get(ownerId) != trip) return;
        pending.remove(ownerId);
        if (!canTravel(owner) || Bukkit.getPlayer(ownerId) != owner || !arrival.getWorld().equals(owner.getWorld())) return;
        Location current = owner.getLocation();
        if (current.distanceSquared(arrival) > ARRIVAL_RANGE * ARRIVAL_RANGE) return;
        if (trip.trialStage() > 0 && !trialArrival(owner, trip.trialStage(), current)) return;

        for (UUID id : trip.companions()) {
            EntityMaid maid = followingMaid(id, ownerId, trip.source());
            if (maid == null || (trip.source().equals(owner.getWorld())
                    && maid.getBukkitEntity().getLocation().distanceSquared(current) < 16)) continue;
            Location landing = trip.trialStage() > 0
                ? safe(current, candidate -> trialArrival(owner, trip.trialStage(), candidate)) : safe(current);
            if (landing == null) {
                owner.sendMessage("[女仆·随行] 附近没有已加载的安全落点，伙伴暂未传送；请先站到有地面、两格净空的地方，再查询女仆位置。");
                continue;
            }
            if (!transfer(maid, landing)) {
                owner.sendMessage("[女仆·随行] 未确认伙伴到达。请查询 context 的当前维度和位置。");
            }
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
        EntityMaid maid = HybridMaidPlugin.nativeMaid(Bukkit.getEntity(id));
        if (maid == null || !ownerId.equals(maid.getOwnerUUID()) || !source.equals(maid.getBukkitEntity().getWorld())
                || !plugin.sharedDialogueEnabled(maid) || !maid.isAlive() || maid.isRemoved() || maid.isNoAi()
                || maid.isSleeping()) return null;
        boolean idle = maid.getTask().getUid().toString().equals("touhou_little_maid:idle");
        // Model-selected short waiting is still companionship, not permanent stationing.
        // Keep the lease and original identity across an accepted partner departure.
        // Native following resumes on expiry in the arrival world.
        boolean temporaryWait = idle && MaidCompanionActions.waiting(maid)
                && maid.isMaidInSittingPose() && maid.isHomeModeEnable() && !maid.isPassenger() && !maid.isVehicle();
        if (!temporaryWait && (maid.isMaidInSittingPose() || maid.isHomeModeEnable() || !maid.canBrainMoving())) return null;
        return idleOrAutoDefending(maid) ? maid : null;
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

    private static boolean safeBlock(Location at) {
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
