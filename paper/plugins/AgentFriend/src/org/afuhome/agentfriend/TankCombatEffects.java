package org.afuhome.agentfriend;

import java.util.*;
import org.bukkit.*;
import org.bukkit.entity.*;
import org.bukkit.event.*;
import org.bukkit.event.entity.*;
import org.bukkit.event.player.*;
import org.bukkit.util.Vector;

/** Bounded tank mechanics. Uses real hostile entities, Bukkit target/damage
 * events and the existing profession/cooldown/mana ledger. No player taunting. */
final class TankCombatEffects implements Listener {
    private record Taunt(UUID caster,String skill,UUID world,long until) { }
    private record Guard(String skill,UUID world,long until,double cap) { }
    private final AgentFriendPlugin plugin;
    private final ProfessionManager manager;
    private final Map<UUID,Taunt> taunts=new HashMap<>();
    private final Map<UUID,Guard> guards=new HashMap<>();
    TankCombatEffects(AgentFriendPlugin plugin,ProfessionManager manager){
        this.plugin=plugin;this.manager=manager;Bukkit.getPluginManager().registerEvents(this,plugin);
        Bukkit.getScheduler().runTaskTimer(plugin,this::expire,10,10);
    }
    private boolean sameEncounter(Player p,Mob mob){
        var own=plugin.trialRescue().team(p.getUniqueId());
        if(mob.getTarget() instanceof Player other){
            var theirs=plugin.trialRescue().team(other.getUniqueId());
            if(own!=null||theirs!=null)return own!=null&&theirs!=null&&own.id().equals(theirs.id())&&!own.paused()
                    &&own.contains().test(mob.getLocation())&&own.contains().test(p.getLocation());
        }
        // A player outside a registered encounter must not steal that room's mobs.
        if(mob.getScoreboardTags().contains("afu_site_dungeon")||mob.getScoreboardTags().contains("afu_dungeon_mob"))
            return own!=null&&!own.paused()&&own.contains().test(mob.getLocation())&&own.contains().test(p.getLocation());
        return true;
    }
    void taunt(Player p,ProfessionCatalog.Skill skill){
        long now=System.currentTimeMillis();
        var targets=p.getNearbyEntities(skill.range(),skill.range(),skill.range()).stream()
                .filter(e->e instanceof Enemy&&e instanceof Mob&&e.isValid()&&!e.isDead()&&!e.isInvulnerable())
                .map(e->(Mob)e).filter(e->e.getLocation().distanceSquared(p.getLocation())<=skill.range()*skill.range())
                .filter(e->p.hasLineOfSight(e)&&sameEncounter(p,e))
                .filter(e->!taunts.containsKey(e.getUniqueId())||taunts.get(e.getUniqueId()).until<=now)
                .sorted(Comparator.comparingDouble(e->e.getLocation().distanceSquared(p.getLocation())))
                .limit(skill.targets()).toList();
        if(targets.isEmpty()){manager.result(p,"cast","no_target",skill.id());return;}
        if(!manager.begin(p,skill))return;int count=0;
        for(Mob target:targets){
            // CraftMob#setTarget on 1.21.1 suppresses the native target event.
            // Explicitly offer the change to other protections before applying it.
            var event=new EntityTargetLivingEntityEvent(target,p,EntityTargetEvent.TargetReason.CUSTOM);
            Bukkit.getPluginManager().callEvent(event);
            if(event.isCancelled()||event.getTarget()!=p)continue;
            target.setTarget(p);if(target.getTarget()!=p)continue;
            taunts.put(target.getUniqueId(),new Taunt(p.getUniqueId(),skill.id(),p.getWorld().getUID(),now+skill.ticks()*50L));
            target.getWorld().spawnParticle(Particle.ANGRY_VILLAGER,target.getLocation().add(0,1.8,0),2,.15,.1,.15,0);count++;
        }
        if(count==0){manager.refund(p,skill,"protected_target");return;}
        manager.succeeded(p,skill,"已吸引 "+count+" 名敌人，持续 "+skill.ticks()/20+" 秒；持盾并留在12格内维持。");
    }
    void bastion(Player p,ProfessionCatalog.Skill skill){
        var old=guards.get(p.getUniqueId());if(old!=null&&old.until>System.currentTimeMillis()){
            manager.result(p,"cast","already_effective",skill.id());return;}
        if(!manager.begin(p,skill))return;
        guards.put(p.getUniqueId(),new Guard(skill.id(),p.getWorld().getUID(),System.currentTimeMillis()+skill.ticks()*50L,skill.power()));
        manager.succeeded(p,skill,"持盾正面减伤50%，单次最多 "+skill.power()+" 点，持续 "+skill.ticks()/20+" 秒。");
    }
    private boolean valid(Player p,Taunt t,Entity enemy){
        var skill=manager.skill(t.skill);
        return p!=null&&skill!=null&&enemy instanceof Mob mob&&sameEncounter(p,mob)&&TankCombatRules.active(p.isOnline(),!p.isDead()&&!plugin.isDowned(p),p.getWorld().getUID().equals(t.world)&&enemy.getWorld()==p.getWorld(),
                ProfessionManager.equipment(p,"shield"),manager.denial(p,skill,false).equals("ready"),plugin.isObserver(p),plugin.pvpParticipant(p),
                enemy.getWorld()==p.getWorld()?enemy.getLocation().distanceSquared(p.getLocation()):Double.POSITIVE_INFINITY,System.currentTimeMillis(),t.until);
    }
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)
    public void targeting(EntityTargetLivingEntityEvent e){
        var t=taunts.get(e.getEntity().getUniqueId());if(t==null)return;var p=Bukkit.getPlayer(t.caster);
        if(!valid(p,t,e.getEntity())){taunts.remove(e.getEntity().getUniqueId());return;}
        if(e.getTarget()!=p)e.setTarget(p);
    }
    boolean reduce(EntityDamageByEntityEvent e){
        if(!(e.getEntity() instanceof Player p)||plugin.pvpParticipant(p))return false;var g=guards.get(p.getUniqueId());
        if(g==null||g.until<=System.currentTimeMillis()||!p.getWorld().getUID().equals(g.world))return false;
        LivingEntity source=e.getDamager() instanceof LivingEntity l?l:e.getDamager() instanceof Projectile s&&s.getShooter() instanceof LivingEntity l?l:null;
        var skill=manager.skill(g.skill);
        if(!(source instanceof Enemy)||skill==null||!manager.denial(p,skill,false).equals("ready")||!ProfessionManager.equipment(p,"shield"))return false;
        Vector toward=source.getLocation().toVector().subtract(p.getLocation().toVector()).setY(0);
        Vector facing=p.getLocation().getDirection().setY(0);
        if(toward.lengthSquared()>.001&&facing.lengthSquared()>.001&&toward.normalize().dot(facing.normalize())<.25)return false;
        double before=e.getFinalDamage(),desired=TankCombatRules.remaining(before,g.cap,.5),low=0,high=e.getDamage();
        for(int i=0;i<14;i++){double mid=(low+high)/2;e.setDamage(mid);if(e.getFinalDamage()<desired)low=mid;else high=mid;}
        e.setDamage(high); return true;
    }
    private void expire(){long now=System.currentTimeMillis();
        guards.entrySet().removeIf(e->e.getValue().until<=now||Bukkit.getPlayer(e.getKey())==null);
        taunts.entrySet().removeIf(e->{var entity=Bukkit.getEntity(e.getKey());return entity==null||!entity.isValid()||entity.isDead()||!valid(Bukkit.getPlayer(e.getValue().caster),e.getValue(),entity);});
    }
    @EventHandler public void quit(PlayerQuitEvent e){guards.remove(e.getPlayer().getUniqueId());taunts.values().removeIf(t->t.caster.equals(e.getPlayer().getUniqueId()));}
}
