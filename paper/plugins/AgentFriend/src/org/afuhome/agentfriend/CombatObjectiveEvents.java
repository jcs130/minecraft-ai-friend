package org.afuhome.agentfriend;

import java.util.UUID;
import java.util.HashMap;
import java.util.Map;
import io.papermc.paper.event.player.PrePlayerAttackEntityEvent;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.entity.Trident;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.entity.EntityShootBowEvent;
import org.bukkit.event.entity.ProjectileLaunchEvent;
import org.bukkit.event.entity.EntityDamageEvent.DamageCause;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.persistence.PersistentDataType;

/** No mob scans/timers. Projectile evidence travels with the real projectile, including saved chunks. */
final class CombatObjectiveEvents implements Listener {
    private final AgentFriendPlugin plugin;
    private final NamespacedKey ownerKey, weaponKey, tokenKey, shotKey, hitOwnerKey, hitWeaponKey, hitTokenKey;
    private record Attack(UUID target, String weapon, String token, int tick) { }
    private final Map<UUID, Attack> attacks = new HashMap<>();
    CombatObjectiveEvents(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        ownerKey = key("contract_shot_owner"); weaponKey = key("contract_shot_weapon");
        tokenKey = key("contract_shot_step"); shotKey = key("contract_shot_time");
        hitOwnerKey = key("contract_hit_owner"); hitWeaponKey = key("contract_hit_weapon"); hitTokenKey = key("contract_hit_step");
    }
    private NamespacedKey key(String name) { return new NamespacedKey(plugin, name); }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void attack(PrePlayerAttackEntityEvent event) {
        Player p = event.getPlayer(); attacks.remove(p.getUniqueId());
        if (!event.willAttack() || p.getGameMode() != GameMode.SURVIVAL || plugin.taskMarket().combat(p) == null) return;
        attacks.put(p.getUniqueId(), new Attack(event.getAttacked().getUniqueId(),
                p.getInventory().getItemInMainHand().getType().name(), plugin.taskMarket().stepToken(p), Bukkit.getCurrentTick()));
    }
    @EventHandler public void quit(PlayerQuitEvent event) { attacks.remove(event.getPlayer().getUniqueId()); }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void bow(EntityShootBowEvent event) {
        if (!(event.getEntity() instanceof Player p) || event.getBow() == null) return;
        shot(p, event.getProjectile(), event.getBow().getType().name());
    }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void trident(ProjectileLaunchEvent event) {
        if (event.getEntity() instanceof Trident t && t.getShooter() instanceof Player p)
            shot(p, t, t.getItemStack().getType().name());
    }
    private void shot(Player p, org.bukkit.entity.Entity projectile, String weapon) {
        if (p.getGameMode() != GameMode.SURVIVAL || plugin.taskMarket().combat(p) == null) return;
        var data = projectile.getPersistentDataContainer();
        data.set(ownerKey, PersistentDataType.STRING, p.getUniqueId().toString());
        data.set(weaponKey, PersistentDataType.STRING, weapon);
        data.set(tokenKey, PersistentDataType.STRING, plugin.taskMarket().stepToken(p));
        data.set(shotKey, PersistentDataType.LONG, System.currentTimeMillis());
    }
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void hit(EntityDamageByEntityEvent event) {
        if (!(event.getDamager() instanceof Player p) || event.getFinalDamage() <= 0) return;
        // Record the weapon at damage time. EntityDeath can run after other listeners have
        // changed the held slot. A player switching to a sword afterwards proves nothing.
        var data = event.getEntity().getPersistentDataContainer();
        data.remove(hitOwnerKey); data.remove(hitWeaponKey); data.remove(hitTokenKey);
        if (p.getGameMode() != GameMode.SURVIVAL || plugin.taskMarket().combat(p) == null) return;
        Attack attack = attacks.get(p.getUniqueId());
        if (attack == null || attack.tick != Bukkit.getCurrentTick() || !attack.token.equals(plugin.taskMarket().stepToken(p))
                || !(event.getCause() == DamageCause.ENTITY_ATTACK && attack.target.equals(event.getEntity().getUniqueId())
                || event.getCause() == DamageCause.ENTITY_SWEEP_ATTACK)) return;
        data.set(hitOwnerKey, PersistentDataType.STRING, p.getUniqueId().toString());
        data.set(hitWeaponKey, PersistentDataType.STRING, attack.weapon);
        data.set(hitTokenKey, PersistentDataType.STRING, plugin.taskMarket().stepToken(p));
    }
    @EventHandler(priority = EventPriority.MONITOR)
    public void death(EntityDeathEvent event) {
        var enemy = event.getEntity(); Player killer = enemy.getKiller();
        if (killer == null || killer.isDead() || killer.getGameMode() != GameMode.SURVIVAL) return;
        CombatObjectives.Spec spec = plugin.taskMarket().combat(killer);
        if (spec == null) return;
        if (!(enemy.getLastDamageCause() instanceof EntityDamageByEntityEvent lethal)) {
            plugin.taskMarket().combatRejected(killer, enemy.getType().name(), null, "environment", "ATTACK_METHOD_MISMATCH"); return;
        }
        String token = plugin.taskMarket().stepToken(killer), weapon, attack;
        if (lethal.getDamager() == killer) {
            var data = enemy.getPersistentDataContainer();
            if (!killer.getUniqueId().toString().equals(data.get(hitOwnerKey, PersistentDataType.STRING))
                    || !token.equals(data.get(hitTokenKey, PersistentDataType.STRING))) {
                plugin.taskMarket().combatRejected(killer, enemy.getType().name(), null, lethal.getCause().name(), "MELEE_EVIDENCE_MISSING"); return;
            }
            weapon = data.get(hitWeaponKey, PersistentDataType.STRING); attack = "melee";
        } else if (lethal.getDamager() instanceof Projectile arrow && arrow.getShooter() instanceof Player shooter
                && shooter.getUniqueId().equals(killer.getUniqueId())) {
            var data = arrow.getPersistentDataContainer();
            if (!killer.getUniqueId().toString().equals(data.get(ownerKey, PersistentDataType.STRING))
                    || !token.equals(data.get(tokenKey, PersistentDataType.STRING))
                    || data.getOrDefault(shotKey, PersistentDataType.LONG, 0L) < plugin.taskMarket().stepStarted(killer)) {
                plugin.taskMarket().combatRejected(killer, enemy.getType().name(), null, "projectile", "PROJECTILE_EVIDENCE_MISSING"); return;
            }
            weapon = data.get(weaponKey, PersistentDataType.STRING); attack = "projectile";
        } else {
            // The gameplay action may succeed while this commission receives no proof.
            plugin.taskMarket().combatRejected(killer, enemy.getType().name(), null, lethal.getCause().name(), "ATTACK_METHOD_MISMATCH"); return;
        }
        if (spec.matches(enemy.getType().name(), weapon, attack))
            plugin.taskMarket().combatKill(killer, enemy.getUniqueId(), enemy.getType().name(), weapon, attack, token);
        else plugin.taskMarket().combatRejected(killer, enemy.getType().name(), weapon, attack,
                spec.mismatch(enemy.getType().name(), weapon, attack));
    }
}
