package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Particle;
import org.bukkit.entity.Enemy;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

/** Passive effects require an equipped, marked vanilla chestplate. */
final class DungeonGearAura implements Listener {
    static final NamespacedKey KEY = NamespacedKey.fromString("agentfriend:gear_aura");
    static final String EMBER = "ember";
    static final String RENEWAL = "renewal";
    static final String LEECH = "leech";
    private static final long OUT_OF_COMBAT_MS = 8_000L;
    private static final long LEECH_INTERVAL_MS = 700L;
    private final JavaPlugin plugin;
    private final Map<UUID, Long> lastCombatAt = new HashMap<>();
    private final Map<UUID, Long> lastLeechAt = new HashMap<>();
    private BukkitTask task;
    private int pulses;

    DungeonGearAura(JavaPlugin plugin) { this.plugin = plugin; }

    void start() {
        Bukkit.getPluginManager().registerEvents(this, plugin);
        task = Bukkit.getScheduler().runTaskTimer(plugin, this::pulse, 40L, 40L);
    }

    void stop() {
        if (task != null) task.cancel();
        lastCombatAt.clear();
        lastLeechAt.clear();
    }

    static String equipped(Player player) {
        if (player == null || player.getGameMode() == GameMode.SPECTATOR) return null;
        ItemStack chest = player.getInventory().getChestplate();
        if (chest == null || !chest.hasItemMeta()) return null;
        String id = chest.getItemMeta().getPersistentDataContainer().get(KEY, PersistentDataType.STRING);
        if (EMBER.equals(id) && chest.getType() == Material.IRON_CHESTPLATE) return id;
        if (RENEWAL.equals(id) && chest.getType() == Material.GOLDEN_CHESTPLATE) return id;
        if (LEECH.equals(id) && chest.getType() == Material.CHAINMAIL_CHESTPLATE) return id;
        return null;
    }

    static JsonArray effects(Player player) {
        JsonArray result = new JsonArray();
        String id = equipped(player);
        if (id == null) return result;
        JsonObject effect = new JsonObject();
        effect.addProperty("id", "gear:" + id);
        effect.addProperty("name", EMBER.equals(id) ? "熔心灼烧"
                : RENEWAL.equals(id) ? "春灯治愈" : "血誓汲取");
        if (EMBER.equals(id) || RENEWAL.equals(id)) {
            effect.addProperty("radius", EMBER.equals(id) ? 4.5 : 5.0);
            effect.addProperty("periodMs", EMBER.equals(id) ? 2000 : 4000);
        } else {
            effect.addProperty("lifestealPercent", 15);
            effect.addProperty("capHpPerHit", 2.0);
        }
        if (RENEWAL.equals(id)) effect.addProperty("requiresOutOfCombatMs", OUT_OF_COMBAT_MS);
        effect.addProperty("passive", true);
        result.add(effect);
        return result;
    }

    private void pulse() {
        pulses++;
        Set<UUID> burned = new HashSet<>();
        Set<UUID> healed = new HashSet<>();
        for (Player wearer : Bukkit.getOnlinePlayers()) {
            if (!wearer.isOnline() || wearer.isDead()) continue;
            String id = equipped(wearer);
            if (EMBER.equals(id)) burn(wearer, burned);
            else if (RENEWAL.equals(id) && pulses % 2 == 0) heal(wearer, healed);
        }
    }

    private void burn(Player wearer, Set<UUID> burned) {
        wearer.getWorld().spawnParticle(Particle.FLAME, wearer.getLocation().add(0, 1.0, 0),
                8, 0.75, 0.35, 0.75, 0.005);
        int hits = 0;
        for (Entity entity : wearer.getNearbyEntities(4.5, 3.0, 4.5)) {
            if (!(entity instanceof Enemy enemy) || enemy.isDead()
                    || wearer.getLocation().distanceSquared(enemy.getLocation()) > 4.5 * 4.5
                    || !wearer.hasLineOfSight(enemy) || !burned.add(enemy.getUniqueId())) continue;
            enemy.setFireTicks(Math.max(enemy.getFireTicks(), 45));
            enemy.damage(0.5, wearer);
            enemy.getWorld().spawnParticle(Particle.SMALL_FLAME,
                    enemy.getLocation().add(0, 0.8, 0), 5, 0.25, 0.35, 0.25, 0.005);
            if (++hits >= 6) break;
        }
    }

    private void heal(Player wearer, Set<UUID> healed) {
        if (inCombat(wearer)) return;
        wearer.getWorld().spawnParticle(Particle.HEART, wearer.getLocation().add(0, 1.3, 0),
                2, 0.6, 0.25, 0.6, 0.005);
        restore(wearer, healed);
        for (Entity entity : wearer.getNearbyEntities(5.0, 3.5, 5.0)) {
            if (entity instanceof Player ally && !ally.isDead()
                    && ally.getGameMode() != GameMode.SPECTATOR
                    && wearer.getLocation().distanceSquared(ally.getLocation()) <= 25.0)
                restore(ally, healed);
        }
    }

    private void restore(Player player, Set<UUID> healed) {
        if (inCombat(player)) return;
        if (!healed.add(player.getUniqueId())) return;
        double maximum = player.getMaxHealth();
        if (player.getHealth() >= maximum) return;
        player.setHealth(Math.min(maximum, player.getHealth() + 1.0));
        player.getWorld().spawnParticle(Particle.HEART, player.getLocation().add(0, 1.7, 0),
                2, 0.25, 0.2, 0.25, 0.005);
    }

    private boolean inCombat(Player player) {
        return System.currentTimeMillis() - lastCombatAt.getOrDefault(player.getUniqueId(), 0L)
                < OUT_OF_COMBAT_MS;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlayerDamaged(EntityDamageEvent event) {
        if (event.getEntity() instanceof Player player && event.getFinalDamage() > 0)
            lastCombatAt.put(player.getUniqueId(), System.currentTimeMillis());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlayerAttack(EntityDamageByEntityEvent event) {
        if (!(event.getEntity() instanceof Enemy) || event.getFinalDamage() <= 0) return;
        Player attacker = event.getDamager() instanceof Player player ? player
                : event.getDamager() instanceof Projectile projectile
                        && projectile.getShooter() instanceof Player shooter ? shooter : null;
        if (attacker == null || attacker.getGameMode() == GameMode.SPECTATOR) return;
        long now = System.currentTimeMillis();
        lastCombatAt.put(attacker.getUniqueId(), now);
        if (!LEECH.equals(equipped(attacker))) return;
        if (now - lastLeechAt.getOrDefault(attacker.getUniqueId(), 0L) < LEECH_INTERVAL_MS) return;
        double amount = Math.min(2.0, event.getFinalDamage() * 0.15);
        if (amount <= 0 || attacker.getHealth() >= attacker.getMaxHealth()) return;
        lastLeechAt.put(attacker.getUniqueId(), now);
        attacker.setHealth(Math.min(attacker.getMaxHealth(), attacker.getHealth() + amount));
        attacker.getWorld().spawnParticle(Particle.DAMAGE_INDICATOR,
                attacker.getLocation().add(0, 1.2, 0), 6, 0.4, 0.3, 0.4, 0.01);
    }

    @EventHandler public void onQuit(PlayerQuitEvent event) {
        UUID id = event.getPlayer().getUniqueId();
        lastCombatAt.remove(id);
        lastLeechAt.remove(id);
    }
}
