package org.qiandengji.vortex;

import io.vortexcore.VortexCorePlugin;
import io.vortexcore.combat.PlayerStateGate;
import io.vortexcore.integration.protection.ProtectionAction;
import io.vortexcore.magic.*;
import io.vortexcore.player.UnifiedPlayer;
import io.vortexcore.rpg.*;
import java.lang.reflect.Method;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import org.bukkit.*;
import org.bukkit.entity.*;
import org.bukkit.event.*;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent.DamageCause;
import org.bukkit.event.entity.ProjectileLaunchEvent;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.scheduler.BukkitTask;

/** Learned techniques and equipment grants over the original Vortex spell IDs. */
final class MartialSpells implements Listener {
    enum Art {
        COUNTER("counterspell","法术反制",VortexClass.MAGE,3,1,9,24_000,Material.AMETHYST_SHARD,
            "在10格内看见祭仪师黄圈读条时打断。等待预警再用。"),
        ECHO("echoing_strikes","回响打击",VortexClass.KNIGHT,5,2,8,22_000,Material.IRON_SWORD,
            "6秒内下一次有效近战命中追加回响，基于原伤害的50%，最多4点。"),
        PIN("pinning_shot","缚足箭",VortexClass.RANGER,4,1,7,20_000,Material.SPECTRAL_ARROW,
            "手持弓或弩。6秒内射出的下一箭命中敌怪后，施加3秒缓慢II；落空即失效。");

        final String id, name, description;
        final VortexClass role;
        final int level, points;
        final double mana;
        final long cooldown;
        final Material icon;
        Art(String id,String name,VortexClass role,int level,int points,double mana,long cooldown,Material icon,String description) {
            this.id=id;this.name=name;this.role=role;this.level=level;this.points=points;this.mana=mana;
            this.cooldown=cooldown;this.icon=icon;this.description=description;
        }
        static Art of(String id) {
            for (Art value : values()) if (value.id.equals(id)) return value;
            return null;
        }
        boolean equipmentAccess(){return this!=PIN;}
        VortexSkillDefinition definition(){return new VortexSkillDefinition(id,role,name,description,icon,level,points,Map.of(),id);}
    }

    private record Armed(Art art, UUID execution, UUID world, long expires) {}
    private record Shot(UUID caster, Armed cast) {}
    private final VortexBridge bridge;
    private final VortexCorePlugin vortex;
    private final EnumMap<Art,VortexSpellRegistration> registered = new EnumMap<>(Art.class);
    private final Map<UUID,Armed> armed = new HashMap<>();
    private final Map<UUID,Shot> shots = new HashMap<>();
    private final Map<UUID,Map<String,Object>> lastEffect = new HashMap<>();
    private final Set<UUID> echoing = new HashSet<>();
    private Method equipped, interrupt;
    private BukkitTask maintenance;

    MartialSpells(VortexBridge bridge,VortexCorePlugin vortex) {this.bridge=bridge;this.vortex=vortex;}
    private boolean configured(){return bridge.getConfig().getBoolean("enchanted-combat-spells.enabled",false);}
    void install() throws ReflectiveOperationException {
        if (!configured()) return;
        var friend = Bukkit.getPluginManager().getPlugin("AgentFriend");
        if (friend == null || !friend.isEnabled()) throw new IllegalStateException("weapon_spell_rules_missing");
        var access = friend.getClass().getClassLoader().loadClass("org.afuhome.agentfriend.GroupSpellAccess");
        equipped = access.getMethod("weaponSpell",Player.class,String.class);
        interrupt = access.getMethod("interruptAltar",Player.class,boolean.class);
        for (Art art : Art.values()) {
            registered.put(art,new VortexSpellRegistration(vortex,art.definition(),new Technique(art),art.cooldown,art.mana,art.equipmentAccess()));
        }
        Bukkit.getPluginManager().registerEvents(this,bridge);
        maintenance=Bukkit.getScheduler().runTaskTimer(bridge,()->{
            if(configured())registered.values().forEach(VortexSpellRegistration::maintain);
            long now=System.currentTimeMillis();
            armed.entrySet().removeIf(entry->{
                if(entry.getValue().expires>=now)return false;
                record(entry.getKey(),entry.getValue(),"ended",Map.of());return true;
            });
            shots.entrySet().removeIf(entry->{
                var shot=entry.getValue();
                if(shot.cast.expires>=now&&Bukkit.getEntity(entry.getKey()) instanceof AbstractArrow arrow&&arrow.isValid()&&!arrow.isInBlock())return false;
                record(shot.caster,shot.cast,"ended",Map.of());return true;
            });
            lastEffect.keySet().removeIf(id->ResidentActors.player(id)==null);
        },1L,20L);
    }
    void stop() {
        if(maintenance!=null)maintenance.cancel();
        registered.values().forEach(VortexSpellRegistration::stop);
        registered.clear();armed.clear();shots.clear();lastEffect.clear();echoing.clear();
    }
    boolean owns(String id){Art art=Art.of(id);return art!=null&&registered.containsKey(art);}
    boolean enabled(){return configured()&&registered.size()==Art.values().length&&registered.values().stream().allMatch(VortexSpellRegistration::enabled);}
    String source(Player p,UnifiedPlayer state,String id) {
        Art art=Art.of(id);
        if(art==null||!enabled())return "";
        if(vortex.classSkillService().selectedClass(state).orElse(null)==art.role
                &&vortex.classSkillService().unlockedSkillIds(state).contains(id))return "profession";
        if(art.equipmentAccess()&&state.level()>=3&&vortex.classSkillService().hasClass(state)&&holds(p,id))return "weapon";
        return "";
    }
    boolean readyCounter(Player p,UnifiedPlayer state) {
        return !source(p,state,Art.COUNTER.id).isEmpty()&&counter(p,false);
    }
    Map<String,Object> evidence(UUID id){return lastEffect.getOrDefault(id,Map.of());}
    private boolean holds(Player p,String id){return flag(equipped,p,id);}
    private boolean counter(Player p,boolean apply){return flag(interrupt,p,apply);}
    private static boolean flag(Method method,Object...args) {
        if(method==null)return false;
        try{return Boolean.TRUE.equals(method.invoke(null,args));}
        catch(ReflectiveOperationException|RuntimeException failed){return false;}
    }
    private boolean sword(Player p){
        var material=p.getInventory().getItemInMainHand().getType().name();
        return material.endsWith("_SWORD")||material.endsWith("_AXE");
    }
    private boolean bow(Player p){
        Material item=p.getInventory().getItemInMainHand().getType();return item==Material.BOW||item==Material.CROSSBOW;
    }

    private final class Technique implements CompiledSpell {
        private final Art art;
        Technique(Art art){this.art=art;}
        @Override public String id(){return art.id;}
        @Override public TriggerType triggerType(){return TriggerType.CAST;}
        @Override public List<SpellTargeter> targeters(){return List.of();}
        @Override public List<SpellCondition> conditions(){return List.of();}
        @Override public List<SpellMechanic> mechanics(){return List.of();}
        @Override public CompletionStage<Void> execute(SpellContext context) {
            if(!(context.triggerSource() instanceof Player p)||source(p,context.caster(),art.id).isEmpty()||!PlayerStateGate.allowed(p))
                return fail("weapon_skill_unavailable","在职业技能中学习，或装备含该刻印的武器（Lv.3）。");
            UUID id=p.getUniqueId(), operation=context.executionId();
            if(art==Art.COUNTER){
                if(!counter(p,true))return fail("no_interruptible_cast","等待10格内可见祭仪师出现黄圈读条。");
                lastEffect.put(id,Map.of("id",art.id,"operationId",operation.toString(),"phase","interrupted","interrupted",true));
            }else{
                if(art==Art.ECHO&&!sword(p))return fail("melee_weapon_required","手持剑或战斧再发动回响。");
                if(art==Art.PIN&&!bow(p))return fail("ranged_weapon_required","手持弓或弩再发动缚足箭。");
                armed.put(id,new Armed(art,operation,p.getWorld().getUID(),System.currentTimeMillis()+6000));
                lastEffect.put(id,Map.of("id",art.id,"operationId",operation.toString(),"phase","armed","damage",0,"slowTicks",0));
            }
            return CompletableFuture.completedFuture(null);
        }
        private CompletionStage<Void> fail(String reason,String message){
            return CompletableFuture.failedFuture(new IllegalArgumentException("["+reason+"] "+message));
        }
    }

    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void hit(EntityDamageByEntityEvent event) {
        if(event.getDamager() instanceof AbstractArrow){
            Shot shot=shots.remove(event.getDamager().getUniqueId());
            if(shot!=null)pinHit(event,shot);
            return;
        }
        if(event.getCause()!=DamageCause.ENTITY_ATTACK||event.getFinalDamage()<=0
                ||!(event.getEntity() instanceof Enemy target)||target.isDead())return;
        UUID id=event.getDamager().getUniqueId();
        Armed echo=armed.get(id);
        if(echo==null||echo.art!=Art.ECHO||echo.expires<System.currentTimeMillis()||echoing.contains(id))return;
        Player p=ResidentActors.player(id);
        if(!canEcho(p,target,echo))return;
        armed.remove(id);
        double power=Math.min(4,event.getFinalDamage()*.5);
        double beforeHit=target.getHealth();
        Bukkit.getScheduler().runTaskLater(bridge,()->{
            Player caster=ResidentActors.player(id);
            if(!canEcho(caster,target,echo)||target.getHealth()>=beforeHit){
                record(id,echo,"ended",Map.of("damage",0));return;
            }
            echoing.add(id);
            double before=target.getHealth();
            try{target.damage(power,ResidentActors.source(caster));}
            finally{echoing.remove(id);}
            double delta=Math.max(0,before-target.getHealth());
            if(delta>0)target.getWorld().spawnParticle(Particle.SWEEP_ATTACK,target.getLocation().add(0,1,0),1);
            record(id,echo,delta>0?"hit":"ended",Map.of("damage",delta));
        },12L);
    }

    @EventHandler(priority=EventPriority.MONITOR,ignoreCancelled=true)
    public void arrowLaunched(ProjectileLaunchEvent event){
        if(!(event.getEntity() instanceof AbstractArrow arrow)||arrow instanceof Trident
                ||!(arrow.getShooter() instanceof LivingEntity shooter))return;
        UUID id=shooter.getUniqueId();Armed cast=armed.get(id);
        if(cast==null||cast.art!=Art.PIN||cast.expires<System.currentTimeMillis())return;
        Player caster=ResidentActors.player(id);
        if(caster==null||!bow(caster)||!mayApply(caster,cast))return;
        armed.remove(id);
        shots.put(arrow.getUniqueId(),new Shot(id,new Armed(cast.art,cast.execution,cast.world,System.currentTimeMillis()+4000)));
        record(id,cast,"in_flight",Map.of("slowTicks",0));
    }

    private void pinHit(EntityDamageByEntityEvent event,Shot shot){
        if(shot.cast.expires<System.currentTimeMillis()||event.getFinalDamage()<=0
                ||!(event.getEntity() instanceof Enemy target)||target.isDead()){
            record(shot.caster,shot.cast,"ended",Map.of("slowTicks",0));return;
        }
        double before=target.getHealth();
        Bukkit.getScheduler().runTask(bridge,()->{
            Player caster=ResidentActors.player(shot.caster);
            int ticks=0;
            if(caster!=null&&mayApply(caster,shot.cast)&&target.isValid()&&!target.isDead()&&target.getHealth()<before
                    &&caster.getWorld().equals(target.getWorld())&&caster.getLocation().distanceSquared(target.getLocation())<=32*32
                    &&vortex.protectionHookService().allows(caster,target.getLocation(),ProtectionAction.SPELL_TARGET)){
                PotionEffect prior=target.getPotionEffect(PotionEffectType.SLOWNESS);
                if((prior==null||prior.getAmplifier()<1||prior.getAmplifier()==1&&prior.getDuration()<60)
                        &&target.addPotionEffect(new PotionEffect(PotionEffectType.SLOWNESS,60,1)))ticks=60;
            }
            record(shot.caster,shot.cast,ticks>0?"hit":"ended",Map.of("slowTicks",ticks,"targetUuid",target.getUniqueId().toString()));
        });
    }

    private boolean mayApply(Player p,Armed origin){
        return origin.world.equals(p.getWorld().getUID())&&PlayerStateGate.allowed(p)
            &&vortex.playerProfileService().profile(p.getUniqueId()).filter(s->!source(p,s,origin.art.id).isEmpty()).isPresent();
    }
    private boolean canEcho(Player p,Enemy target,Armed origin){
        return p!=null&&target.isValid()&&!target.isDead()&&origin.world.equals(p.getWorld().getUID())
            &&p.getWorld().equals(target.getWorld())&&p.getLocation().distanceSquared(target.getLocation())<=64
            &&p.hasLineOfSight(target)&&sword(p)&&mayApply(p,origin)
            &&vortex.protectionHookService().allows(p,target.getLocation(),ProtectionAction.SPELL_TARGET);
    }
    private void record(UUID caster,Armed origin,String phase,Map<String,Object> measured){
        var prior=lastEffect.get(caster);
        if(prior!=null&&origin.execution.toString().equals(prior.get("operationId"))){
            var result=new LinkedHashMap<>(measured);
            result.put("id",origin.art.id);result.put("operationId",origin.execution.toString());result.put("phase",phase);
            lastEffect.put(caster,Map.copyOf(result));
        }
    }
}
