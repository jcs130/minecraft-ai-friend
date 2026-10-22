package org.afuhome.agentvision;

import com.dwinovo.numen.api.entity.NumenPlayer;
import com.dwinovo.numen.scan.NearbyEntities;
import io.papermc.paper.event.player.PlayerTrackEntityEvent;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.minecraft.network.protocol.game.ClientboundPlayerInfoRemovePacket;
import net.minecraft.network.protocol.game.ClientboundPlayerInfoUpdatePacket;
import org.afuhome.agentfriend.AgentVisionBridge;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.craftbukkit.entity.CraftEntity;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Item;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerGameModeChangeEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.ServicePriority;
import org.bukkit.plugin.java.JavaPlugin;

/** Only world-entity visibility is filtered; the server retains normal gameplay and tab-list identity. */
public final class AgentVisionPlugin extends JavaPlugin implements Listener, AgentVisionBridge.Reveals {
    private static final class Target {
        final Entity entity;
        boolean hidden;
        long nextCheck;
        long revealUntil;
        Target(Entity entity) { this.entity = entity; }
    }

    private static final class Viewer {
        final Player player;
        final Map<UUID, Target> targets = new HashMap<>();
        final ArrayDeque<Target> pending = new ArrayDeque<>();
        Target approvedSpawn;
        int remainingVisits;
        Viewer(Player player) { this.player = player; }
        Target target(Entity entity) {
            return targets.computeIfAbsent(entity.getUniqueId(), id -> {
                Target target = new Target(entity);
                pending.addLast(target);
                return target;
            });
        }
    }

    private final Map<UUID, Viewer> viewers = new LinkedHashMap<>();
    private final ArrayDeque<Viewer> roundRobin = new ArrayDeque<>();
    private boolean running;
    private double radiusSquared;
    private int interval, maxChecks, maxVisits;
    private long budgetNanos;
    private int budgetTick = Integer.MIN_VALUE, tickChecks, peakChecks;
    private long tickWorkNanos, totalWorkNanos, checks, hides, shows, deferrals, maxTickNanos, totalVisits;
    private int lastVisits, peakVisits;

    @Override public void onEnable() {
        saveDefaultConfig();
        double radius = getConfig().getDouble("radius", 64);
        interval = getConfig().getInt("check-interval-ticks", 4);
        maxChecks = getConfig().getInt("max-checks-per-tick", 128);
        maxVisits = getConfig().getInt("max-visits-per-tick", 512);
        long micros = getConfig().getLong("time-budget-micros", 2000);
        if (radius < 16 || radius > 128 || interval < 1 || interval > 20 || maxChecks < 1
                || maxChecks > 1024 || maxVisits < maxChecks || maxVisits > 4096 || micros < 100 || micros > 10000)
            throw new IllegalArgumentException("AgentVision budget configuration outside documented bounds");
        radiusSquared = radius * radius;
        budgetNanos = micros * 1000;
        // Fail before installing any filter if the shared Numen implementation is incompatible.
        NearbyEntities.work();
        running = true;
        Bukkit.getPluginManager().registerEvents(this, this);
        Bukkit.getServicesManager().register(AgentVisionBridge.Reveals.class, this, this, ServicePriority.Normal);
        Bukkit.getScheduler().runTaskTimer(this, this::tick, 1, 1);
        Bukkit.getOnlinePlayers().forEach(this::ensureViewer);
        Command command = new Command("agentvision") {
            @Override public boolean execute(CommandSender sender, String label, String[] args) {
                if (!sender.hasPermission("agentvision.admin")) {
                    sender.sendMessage("[提示] 此项为管理员诊断。玩法帮助：/mycli --help");
                    return true;
                }
                if (args.length != 1 || !args[0].equals("status")) {
                    sender.sendMessage("[提示] 查询可见性预算与计数。命令：/agentvision status");
                    return true;
                }
                var work = NearbyEntities.work();
                long targets = viewers.values().stream().mapToLong(v -> v.targets.size()).sum();
                sender.sendMessage("MC_VISION {\"enabled\":" + running + ",\"viewers\":" + viewers.size()
                        + ",\"queuedViewers\":" + roundRobin.size()
                        + ",\"targets\":" + targets + ",\"checks\":" + checks + ",\"hides\":" + hides
                        + ",\"shows\":" + shows + ",\"deferred\":" + deferrals
                        + ",\"maxTickMicros\":" + maxTickNanos / 1000 + ",\"maxChecks\":" + maxChecks
                        + ",\"peakChecks\":" + peakChecks
                        + ",\"tick\":" + Bukkit.getCurrentTick() + ",\"visits\":" + totalVisits
                        + ",\"lastVisits\":" + lastVisits + ",\"peakVisits\":" + peakVisits
                        + ",\"workNanos\":" + totalWorkNanos
                        + ",\"budgetMicros\":" + budgetNanos / 1000 + ",\"nativeQueries\":" + work.queries()
                        + ",\"worldRays\":" + work.worldRays() + ",\"shapeSkips\":" + work.shapeSkips()
                        + ",\"hintHits\":" + work.hintHits() + ",\"hintReads\":" + work.hintReads()
                        + ",\"hintEntries\":" + work.hintEntries() + "}");
                return true;
            }
        };
        command.setPermission("agentvision.admin");
        if (!getServer().getCommandMap().register("qiandengji", command))
            throw new IllegalStateException("agentvision command already registered");
        getLogger().info("Shared ordinary vision enabled; radius=" + radius + ", budget=" + micros + "us/tick");
    }

    private boolean managed(Player player) {
        // Server-side Numen bodies use this same predicate internally and have no network client to filter.
        return running && player.isOnline() && !(((CraftPlayer) player).getHandle() instanceof NumenPlayer)
                && AgentVisionBridge.managed(player);
    }

    private Viewer ensureViewer(Player player) {
        if (!managed(player)) return null;
        return viewers.computeIfAbsent(player.getUniqueId(), id -> {
            Viewer viewer = new Viewer(player);
            roundRobin.addLast(viewer);
            return viewer;
        });
    }

    private static boolean ordinary(Entity target) {
        // Private displays, particles and skill guide markers retain the publishing plugin's visibility.
        return target.isVisibleByDefault() && (target instanceof LivingEntity || target instanceof Item);
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onTrack(PlayerTrackEntityEvent event) {
        Viewer viewer = ensureViewer(event.getPlayer());
        Entity entity = event.getEntity();
        if (viewer == null || entity == viewer.player || !ordinary(entity)) return;
        Target target = viewer.target(entity);
        if (viewer.approvedSpawn == target) return; // Same synchronous result, no duplicate ray work on showEntity.
        boolean visible;
        if (target.revealUntil > System.currentTimeMillis()) visible = true;
        else if (reserve()) visible = visible(viewer, target);
        else { deferrals++; visible = false; }
        target.nextCheck = Bukkit.getCurrentTick() + interval;
        if (!visible) {
            event.setCancelled(true);
            hide(viewer, target);
        }
    }

    private boolean visible(Viewer viewer, Target target) {
        long start = System.nanoTime();
        try {
            var observer = ((CraftPlayer) viewer.player).getHandle();
            var entity = ((CraftEntity) target.entity).getHandle();
            if (entity.level() != observer.level() || observer.distanceToSqr(entity) > radiusSquared) return false;
            return NearbyEntities.visibleTo(observer, entity);
        } finally {
            long duration = System.nanoTime() - start;
            tickWorkNanos += duration;
            totalWorkNanos += duration;
        }
    }

    private boolean reserve() {
        int tick = Bukkit.getCurrentTick();
        if (budgetTick != tick) {
            budgetTick = tick;
            tickChecks = 0;
            tickWorkNanos = 0;
        }
        if (tickChecks >= maxChecks || (tickChecks > 0 && tickWorkNanos >= budgetNanos)) return false;
        tickChecks++;
        peakChecks = Math.max(peakChecks, tickChecks);
        checks++;
        return true;
    }

    private void tick() {
        long start = System.nanoTime();
        int visits = 0;
        int remaining = 0, idle = 0;
        for (Viewer viewer : viewers.values()) {
            viewer.remainingVisits = viewer.pending.size();
            remaining += viewer.remainingVisits;
        }
        // Snapshot one pass. A small, not-yet-due queue must not spin all 512 visit slots every tick.
        while (remaining > 0 && !roundRobin.isEmpty() && visits < maxVisits) {
            Viewer viewer = roundRobin.removeFirst();
            if (viewers.get(viewer.player.getUniqueId()) != viewer) continue;
            if (!managed(viewer.player)) {
                remaining -= viewer.remainingVisits;
                removeViewer(viewer, true);
                continue;
            }
            roundRobin.addLast(viewer);
            // Paper temporarily detaches the chunk loader during death/respawn
            // and world transfer while Bukkit still reports the player online.
            // Keep the queue and visibility decisions until the stream resumes;
            // CraftPlayer.isChunkSent dereferences this nullable loader.
            if (((CraftPlayer) viewer.player).getHandle().moonrise$getChunkLoader() == null) {
                remaining -= viewer.remainingVisits;
                viewer.remainingVisits = 0;
                deferrals++;
                continue;
            }
            if (viewer.remainingVisits == 0 || viewer.pending.isEmpty()) {
                if (++idle >= roundRobin.size()) break;
                continue;
            }
            idle = 0;
            viewer.remainingVisits--;
            remaining--;
            visits++;
            Target target = viewer.pending.removeFirst();
            if (viewer.targets.get(target.entity.getUniqueId()) != target) continue;
            if (!target.entity.isValid() || !ordinary(target.entity)
                    || target.entity.getWorld() != viewer.player.getWorld()
                    || !viewer.player.isChunkSent(((CraftEntity) target.entity).getHandle().chunkPosition().toLong())) {
                viewer.targets.remove(target.entity.getUniqueId());
                restore(viewer, target);
                continue;
            }
            viewer.pending.addLast(target);
            if (Bukkit.getCurrentTick() < target.nextCheck) continue;
            if (!reserve()) { deferrals++; break; }
            boolean visible = target.revealUntil > System.currentTimeMillis() || visible(viewer, target);
            target.nextCheck = Bukkit.getCurrentTick() + interval;
            if (visible) restore(viewer, target); else hide(viewer, target);
        }
        lastVisits = visits;
        totalVisits += visits;
        peakVisits = Math.max(peakVisits, visits);
        maxTickNanos = Math.max(maxTickNanos, System.nanoTime() - start);
    }

    private void hide(Viewer viewer, Target target) {
        if (target.hidden) return;
        boolean previouslyVisible = viewer.player.canSee(target.entity);
        target.hidden = true;
        viewer.player.hideEntity(this, target.entity);
        hides++;
        // Tab-list presence is not spatial perception. Keep vanilla sender UUIDs/names for chat identification.
        if (previouslyVisible && target.entity instanceof Player other && other.isOnline())
            ((CraftPlayer) viewer.player).getHandle().connection.send(ClientboundPlayerInfoUpdatePacket
                    .createPlayerInitializing(List.of(((CraftPlayer) other).getHandle())));
    }

    private void restore(Viewer viewer, Target target) {
        if (!target.hidden) return;
        target.hidden = false;
        viewer.approvedSpawn = target;
        try { viewer.player.showEntity(this, target.entity); }
        finally { viewer.approvedSpawn = null; }
        shows++;
        if (target.entity instanceof Player other && !other.isOnline())
            ((CraftPlayer) viewer.player).getHandle().connection.send(
                    new ClientboundPlayerInfoRemovePacket(List.of(other.getUniqueId())));
    }

    private void removeViewer(Viewer viewer, boolean restore) {
        viewers.remove(viewer.player.getUniqueId());
        roundRobin.remove(viewer); // Empty queues no longer spin, so release disconnected viewers here.
        if (restore) for (Target target : viewer.targets.values()) restore(viewer, target);
        viewer.targets.clear();
        viewer.pending.clear();
    }

    @Override public void senseOutline(Player player, Entity entity, boolean active) {
        Viewer viewer = ensureViewer(player);
        if (viewer == null || !ordinary(entity) || player.getWorld() != entity.getWorld()) return;
        Target target = viewer.target(entity);
        // Only a server-side paid spell invokes this service. Renewed every 10 ticks, revoked on spell end.
        target.revealUntil = active ? System.currentTimeMillis() + 1500 : 0;
        if (active) restore(viewer, target);
        else target.nextCheck = 0; // Recheck under the shared budget; ending 64 outlines must not run 64 extra rays here.
    }

    @EventHandler public void onJoin(PlayerJoinEvent event) { ensureViewer(event.getPlayer()); }
    @EventHandler public void onMode(PlayerGameModeChangeEvent event) {
        Bukkit.getScheduler().runTask(this, () -> refreshViewer(event.getPlayer()));
    }
    @EventHandler public void onWorld(PlayerChangedWorldEvent event) { refreshViewer(event.getPlayer()); }
    private void refreshViewer(Player player) {
        Viewer viewer = viewers.get(player.getUniqueId());
        if (viewer != null) removeViewer(viewer, true);
        ensureViewer(player);
    }
    @EventHandler public void onQuit(PlayerQuitEvent event) {
        Player player = event.getPlayer();
        Viewer leaving = viewers.get(player.getUniqueId());
        if (leaving != null) removeViewer(leaving, false);
        for (Viewer viewer : new ArrayList<>(viewers.values())) {
            Target target = viewer.targets.remove(player.getUniqueId());
            if (target != null) restore(viewer, target);
        }
    }

    @Override public void onDisable() {
        running = false;
        Bukkit.getServicesManager().unregisterAll(this);
        for (Viewer viewer : new ArrayList<>(viewers.values())) removeViewer(viewer, true);
        roundRobin.clear();
    }
}
