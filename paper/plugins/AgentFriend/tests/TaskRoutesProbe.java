package org.afuhome.agentfriend.qa;

import org.bukkit.Bukkit;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Projectile;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityShootBowEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.persistence.PersistentDataType;

/** Optional private-stage diagnostics. Never included in AgentFriend or deployed to production. */
public final class TaskRoutesProbe extends JavaPlugin implements Listener {
    public void onEnable() {
        if (!Bukkit.getMotd().contains("TASK_ROUTES_ISOLATED_20261015") || Bukkit.getPort() != 25840)
            throw new IllegalStateException("Refusing non-QA server");
        Bukkit.getPluginManager().registerEvents(this, this);
    }
    private String entity(Entity e) {
        if (e == null) return "none";
        var data=e.getPersistentDataContainer();StringBuilder values=new StringBuilder();
        for(var key:data.getKeys())if(key.getKey().startsWith("contract_")) {
            Object value=data.has(key,PersistentDataType.STRING)?data.get(key,PersistentDataType.STRING)
                    :data.has(key,PersistentDataType.LONG)?data.get(key,PersistentDataType.LONG):"other";
            values.append(key).append('=').append(value).append(';');
        }
        return e.getType() + ":" + e.getUniqueId() + ":" + values;
    }
    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void shot(EntityShootBowEvent e) {
        if (e.getEntity().getName().startsWith("ag_Route")) getLogger().info("SHOT bow="+e.getBow()+" projectile="+entity(e.getProjectile()));
    }
    @EventHandler(priority=EventPriority.MONITOR)
    public void death(EntityDeathEvent e) {
        if (e.getEntity().getScoreboardTags().stream().noneMatch(t->t.startsWith("route_"))) return;
        var cause=e.getEntity().getLastDamageCause();
        getLogger().info("DEATH target="+e.getEntity().getScoreboardTags()+" killer="+(e.getEntity().getKiller()==null?"none":e.getEntity().getKiller().getName())+" cause="+cause);
        if (cause instanceof EntityDamageByEntityEvent d) {
            getLogger().info("DAMAGER "+entity(d.getDamager())+" source="+d.getDamageSource().getDamageType());
            if(d.getDamager() instanceof Projectile p)getLogger().info("SHOOTER "+p.getShooter());
        }
    }
}
