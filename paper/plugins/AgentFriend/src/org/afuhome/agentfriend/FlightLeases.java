package org.afuhome.agentfriend;

import java.util.*;
import org.bukkit.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.*;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.potion.*;
import org.bukkit.scheduler.BukkitTask;

/** One owner for paid temporary flight. Basic flight and profession flight cannot nest. */
final class FlightLeases implements Listener {
    record Lease(UUID token, UUID world, String skill, int level, long started, long expires,
            boolean allowed, boolean flying, float speed) { }
    private final AgentFriendPlugin plugin;
    private final Map<UUID, Lease> leases = new HashMap<>();
    private final NamespacedKey recovery;
    private final BukkitTask task;

    FlightLeases(AgentFriendPlugin plugin) {
        this.plugin = plugin; recovery = new NamespacedKey(plugin, "temporary_flight_recovery");
        Bukkit.getPluginManager().registerEvents(this, plugin);
        task = Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 5L, 5L);
        Bukkit.getOnlinePlayers().forEach(this::recover);
    }
    String denial(Player p) {
        if (p.getGameMode() != GameMode.SURVIVAL || !p.isOnline() || p.isDead() || plugin.isDowned(p)) return "survival_required";
        if (leases.containsKey(p.getUniqueId()) || p.isFlying()) return "already_effective";
        if (p.isInsideVehicle() || p.isGliding()) return "unsafe_path";
        return leases.size() >= 40 ? "activity_active" : "ready";
    }
    Lease active(Player p) {
        Lease lease = leases.get(p.getUniqueId());
        return lease != null && lease.world.equals(p.getWorld().getUID()) && lease.expires > System.currentTimeMillis() ? lease : null;
    }
    boolean start(Player p, String skill, int level, int seconds) {
        if (!denial(p).equals("ready") || !Set.of("flight", "mage_soar").contains(skill) || seconds < 1 || seconds > 60) return false;
        long now = System.currentTimeMillis();
        Lease lease = new Lease(UUID.randomUUID(), p.getWorld().getUID(), skill, level, now, now + seconds * 1000L,
                p.getAllowFlight(), p.isFlying(), p.getFlySpeed());
        // Flags and this marker are serialized together in player NBT. A crash cannot leave a
        // saved temporary permission without the original flags needed at the next login.
        p.getPersistentDataContainer().set(recovery, PersistentDataType.STRING,
                (lease.allowed ? "1" : "0") + "," + (lease.flying ? "1" : "0") + "," + lease.speed);
        leases.put(p.getUniqueId(), lease);
        try {
            p.setAllowFlight(true); p.setFlySpeed(.07f); p.setFlying(true); p.setFallDistance(0);
            return true;
        } catch (RuntimeException error) {
            end(p, false); plugin.getLogger().warning("Temporary flight could not start: " + p.getUniqueId()); return false;
        }
    }
    void end(Player p, boolean slowFall) {
        Lease lease = leases.remove(p.getUniqueId()); if (lease == null) return;
        restore(p, lease.allowed, lease.flying, lease.speed, slowFall);
    }
    void end(UUID id, boolean slowFall) {
        Player p = Bukkit.getPlayer(id);
        if (p != null) end(p, slowFall);
        else leases.remove(id); // NBT marker remains for the next login, never assume old flags.
    }
    private void restore(Player p, boolean allowed, boolean flying, float speed, boolean slowFall) {
        p.setFlySpeed(speed);
        if (p.getGameMode() == GameMode.SURVIVAL || p.getGameMode() == GameMode.ADVENTURE) {
            p.setFlying(flying && allowed); p.setAllowFlight(allowed); p.setFallDistance(0);
            if (slowFall && !p.isDead()) p.addPotionEffect(new PotionEffect(PotionEffectType.SLOW_FALLING, 160, 0, false, true));
        }
        p.getPersistentDataContainer().remove(recovery);
    }
    private void recover(Player p) {
        if (leases.containsKey(p.getUniqueId())) return;
        String raw = p.getPersistentDataContainer().get(recovery, PersistentDataType.STRING);
        if (raw == null) return;
        boolean allowed = false, flying = false; float speed = .1f;
        try {
            String[] parts = raw.split(",", -1);
            if (parts.length != 3 || !Set.of("0", "1").contains(parts[0]) || !Set.of("0", "1").contains(parts[1])) throw new IllegalArgumentException();
            speed = Float.parseFloat(parts[2]);
            if (!Float.isFinite(speed) || speed < -1 || speed > 1) throw new IllegalArgumentException();
            allowed = parts[0].equals("1"); flying = parts[1].equals("1");
        } catch (RuntimeException invalid) {
            allowed = false; flying = false; speed = .1f;
            plugin.getLogger().warning("Invalid flight recovery marker; revoking temporary flight for " + p.getUniqueId());
        }
        restore(p, allowed, flying, speed, true);
    }
    private void tick() {
        for (UUID id : List.copyOf(leases.keySet())) {
            Player p = Bukkit.getPlayer(id); Lease lease = leases.get(id);
            if (p == null || !p.isOnline()) { leases.remove(id); continue; }
            if (p.isDead() || plugin.isDowned(p) || p.getGameMode() != GameMode.SURVIVAL || p.isInsideVehicle()
                    || p.isGliding() || !p.getWorld().getUID().equals(lease.world) || System.currentTimeMillis() >= lease.expires) end(p, true);
        }
    }
    @EventHandler(priority = EventPriority.MONITOR) public void join(PlayerJoinEvent e) { recover(e.getPlayer()); }
    @EventHandler(priority = EventPriority.MONITOR) public void quit(PlayerQuitEvent e) { end(e.getPlayer(), false); }
    @EventHandler(priority = EventPriority.MONITOR) public void death(PlayerDeathEvent e) { end(e.getEntity(), false); }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true) public void mode(PlayerGameModeChangeEvent e) { end(e.getPlayer(), false); }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true) public void teleport(PlayerTeleportEvent e) { end(e.getPlayer(), true); }
    @EventHandler(priority = EventPriority.MONITOR) public void world(PlayerChangedWorldEvent e) { end(e.getPlayer(), true); }
    void shutdown() { task.cancel(); for (UUID id : List.copyOf(leases.keySet())) end(id, true); }
}
