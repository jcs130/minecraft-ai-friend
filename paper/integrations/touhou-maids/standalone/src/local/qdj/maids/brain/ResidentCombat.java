package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.api.task.IAttackTask;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.entity.task.*;
import com.github.tartaricacid.touhoulittlemaid.init.InitEntities;
import java.util.*;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.component.DataComponents;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.entity.*;
import net.minecraft.world.entity.ai.memory.MemoryModuleType;
import net.minecraft.world.entity.monster.Enemy;
import net.minecraft.world.entity.projectile.Projectile;
import net.minecraft.world.entity.schedule.Activity;
import net.minecraft.world.item.*;

/** Per-body, server-tick reflexes. Native TLM performs navigation, attacks and ammunition consumption. */
final class ResidentCombat {
    private static final String BACKUP="tlm_resident_combat_task";
    private static final List<ResourceLocation> TASKS=List.of(TaskBowAttack.UID,TaskCrossBowAttack.UID,TaskAttack.UID);
    private record Weapon(IAttackTask task,int slot,ItemStack stack,boolean ranged){}
    private static final class State {
        UUID target; long acquired,lastHit,lastSkill,switched; int hits,swaps;
        String mode="idle",reason="no_visible_hostile";
        Map<String,Object> hit=Map.of(),skill=Map.of();
        final Map<UUID,Long> stalled=new HashMap<>();
    }
    private final MaidResidents residents;
    private final Map<UUID,State> states=new HashMap<>();
    ResidentCombat(MaidResidents residents){this.residents=residents;}
    boolean active(UUID id){var s=states.get(id);return s!=null&&s.target!=null;}
    Map<String,Object> observe(UUID id){var s=states.computeIfAbsent(id,k->new State());var row=new LinkedHashMap<String,Object>();
        row.put("enabled",residents.role(id).combat());row.put("mode",s.mode);row.put("reason",s.reason);
        row.put("targetId",s.target==null?null:s.target.toString());row.put("actualHits",s.hits);row.put("weaponSwaps",s.swaps);
        row.put("lastHit",s.hit);row.put("lastSkill",s.skill);row.put("decisionIntervalMs",250);
        row.put("attackExecutor","native_tlm");row.put("modelCallsPerAttack",0);return row;
    }
    static boolean hostile(EntityMaid maid,LivingEntity target){
        if(target==maid||!target.isAlive()||target.isInvulnerable()||target.isSpectator()||target.level()!=maid.level()
            ||target instanceof EntityMaid||target instanceof net.minecraft.world.entity.player.Player
            ||target instanceof TamableAnimal||!(target instanceof Enemy)||!maid.canAttack(target)||maid.isAlliedTo(target)
            ||target instanceof Mob mob&&mob.isNoAi())return false;
        if(target instanceof NeutralMob&&(!(target instanceof Mob mob)||mob.getTarget()!=maid&&!residentsAlly(maid,mob.getTarget())))return false;
        return ResidentProtection.combat(maid,target);
    }
    private static boolean residentsAlly(EntityMaid maid,LivingEntity target){
        var r=MaidAgentsMod.residents();return r!=null&&target!=null&&r.allies(maid).contains(target);
    }
    static boolean visibleHostile(EntityMaid maid,LivingEntity target,double range){
        return hostile(maid,target)&&maid.distanceToSqr(target)<=range*range&&maid.hasLineOfSight(target);
    }
    private static boolean ammunition(EntityMaid maid,ItemStack weapon){
        if(!(weapon.getItem() instanceof ProjectileWeaponItem projectile))return true;
        var charged=weapon.get(DataComponents.CHARGED_PROJECTILES);
        if(weapon.getItem() instanceof CrossbowItem&&charged!=null&&!charged.isEmpty())return true;
        // TLM's bow reads real arrows from its unlocked inventory, not an invented ammo count.
        var accepts=projectile.getAllSupportedProjectiles();
        for(int i=0;i<ResidentBodyAccess.capacity(maid.getUUID());i++)if(accepts.test(maid.getMaidInv().getStackInSlot(i)))return true;
        return false;
    }
    private static Weapon weapon(EntityMaid maid,ItemStack stack,int slot){
        if(stack.isEmpty()||stack.getCount()!=1)return null;
        for(var id:TASKS)if(TaskManager.getTaskMap().get(id) instanceof IAttackTask task&&task.isEnable(maid)&&task.isWeapon(maid,stack)){
            boolean ranged=!id.equals(TaskAttack.UID);if(ranged&&!ammunition(maid,stack))return null;
            return new Weapon(task,slot,stack,ranged);
        }
        return null;
    }
    private static List<Weapon> weapons(EntityMaid maid){var out=new ArrayList<Weapon>();
        var current=weapon(maid,maid.getMainHandItem(),-1);if(current!=null)out.add(current);
        for(int i=0;i<ResidentBodyAccess.capacity(maid.getUUID());i++){var w=weapon(maid,maid.getMaidInv().getStackInSlot(i),i);if(w!=null)out.add(w);}
        out.sort(Comparator.comparingDouble(ResidentCombat::weaponDamage).reversed());return out;
    }
    private static double weaponDamage(Weapon w){return w.stack().getAttributeModifiers().modifiers().stream()
        .filter(e->e.attribute().equals(net.minecraft.world.entity.ai.attributes.Attributes.ATTACK_DAMAGE))
        .mapToDouble(e->e.modifier().amount()).sum();}
    private static boolean clearShot(EntityMaid maid,LivingEntity target){
        if(target==null)return false;
        var from=maid.getEyePosition();var to=target.getEyePosition();
        return maid.level().getEntitiesOfClass(LivingEntity.class,maid.getBoundingBox().expandTowards(to.subtract(from)).inflate(1),
            e->e!=maid&&e!=target&&e.isAlive()).stream().noneMatch(e->!hostile(maid,e)&&e.getBoundingBox().inflate(.35).clip(from,to).isPresent());
    }
    void stop(EntityMaid maid,String reason){
        var s=states.computeIfAbsent(maid.getUUID(),k->new State());s.target=null;s.mode="idle";s.reason=reason;
        var p=maid.getPersistentData();if(!p.contains(BACKUP))return;
        String original=p.getString(BACKUP),applied=p.getString(BACKUP+"_applied");
        maid.getBrain().eraseMemory(MemoryModuleType.ATTACK_TARGET);maid.setTarget(null);maid.stopUsingItem();
        maid.getNavigation().stop();maid.getBrain().eraseMemory(MemoryModuleType.WALK_TARGET);
        // Never undo a manual task change. Equipment stays real and is never recreated from a snapshot.
        if(maid.getTask().getUid().toString().equals(applied))TaskManager.findTask(ResourceLocation.parse(original)).ifPresent(maid::setTask);
        maid.setSchedule(maid.getSchedule());p.remove(BACKUP);p.remove(BACKUP+"_applied");
    }
    void tick(EntityMaid maid,boolean permitted){
        var id=maid.getUUID();var s=states.computeIfAbsent(id,k->new State());var role=residents.role(id);long now=ResidentRpg.now(maid);
        if(!permitted||!role.combat()||!maid.isAlive()||maid.isNoAi()||maid.guiOpening||maid.isMaidInSittingPose()
            ||maid.isSleeping()||maid.isPassenger()||maid.getPersistentData().getBoolean(ResidentBodyAccess.DOWNED)){
            stop(maid,"body_controlled_or_unavailable");return;
        }
        // A persisted marker after a restart only restores a task; it never replays a shot or a spell.
        if(!active(id)&&maid.getPersistentData().contains(BACKUP))stop(maid,"recovered_native_task");
        s.stalled.entrySet().removeIf(e->e.getValue()<=now);
        LivingEntity target=s.target==null?null:maid.level().getEntitiesOfClass(LivingEntity.class,maid.getBoundingBox().inflate(16),e->e.getUUID().equals(s.target)).stream().findFirst().orElse(null);
        if(target!=null&&now-Math.max(s.acquired,s.lastHit)>300){s.stalled.put(target.getUUID(),now+200);target=null;stop(maid,"target_stalled_no_damage");}
        if(target==null||!visibleHostile(maid,target,16))target=maid.level().getEntitiesOfClass(LivingEntity.class,maid.getBoundingBox().inflate(16),
            e->!s.stalled.containsKey(e.getUUID())&&visibleHostile(maid,e,16)).stream()
            .min(Comparator.<LivingEntity>comparingDouble(maid::distanceToSqr).thenComparing(e->e.getUUID().toString())).orElse(null);
        if(target==null){stop(maid,"no_visible_hostile");support(maid,s,role,now,false);return;}
        boolean newlyActive=!active(id);
        if(newlyActive)residents.combatStarted(id);
        if(!target.getUUID().equals(s.target)){s.target=target.getUUID();s.acquired=now;}
        var loadout=weapons(maid);double distance=maid.distanceToSqr(target);
        boolean ranged=distance>(s.mode.equals("ranged")?9:25)&&clearShot(maid,target);
        var choice=loadout.stream().filter(w->w.ranged()==ranged).findFirst().orElseGet(()->loadout.stream().filter(w->!w.ranged()||clearShot(maid,findTarget(maid,s.target))).findFirst().orElse(null));
        support(maid,s,role,now,true);
        if(choice==null){s.mode="unarmed";s.reason="no_usable_weapon_or_ammunition";maid.getBrain().eraseMemory(MemoryModuleType.ATTACK_TARGET);maid.setTarget(null);return;}
        try{
            if(choice.slot()>=0){MaidAgent.equip(maid,"mainhand",choice.slot(),BuiltInRegistries.ITEM.getKey(choice.stack().getItem()));s.swaps++;s.switched=now;}
            var p=maid.getPersistentData();if(!p.contains(BACKUP))p.putString(BACKUP,maid.getTask().getUid().toString());
            if(maid.getTask()!=choice.task()){maid.stopUsingItem();maid.setTask(choice.task());}
            p.putString(BACKUP+"_applied",choice.task().getUid().toString());
            maid.getBrain().setSchedule(InitEntities.MAID_ALL_DAY_SCHEDULES.get());maid.getBrain().setActiveActivityIfPossible(Activity.WORK);
            maid.getBrain().setMemory(MemoryModuleType.ATTACK_TARGET,target);
            s.mode=choice.ranged()?"ranged":"melee";s.reason="native_attack_pending_actual_damage";
        }catch(IllegalArgumentException blocked){stop(maid,"equipment_refused:"+blocked.getMessage());}
    }
    private static LivingEntity findTarget(EntityMaid maid,UUID id){return (LivingEntity)((net.minecraft.server.level.ServerLevel)maid.level()).getEntity(id);}
    private void support(EntityMaid maid,State s,ResidentConfig.Resident role,long now,boolean fighting){
        if(now-s.lastSkill<20)return;s.lastSkill=now;
        if(ResidentVortex.selected()){var result=ResidentVortex.reflex(maid,fighting);if(!result.isEmpty())s.skill=result;return;}
        String skill=switch(role.profession()){
            case "guardian"->fighting?"guard":null;
            case "ranger"->fighting&&s.target!=null&&findTarget(maid,s.target)!=null&&maid.distanceToSqr(findTarget(maid,s.target))>16?"sprint":null;
            case "mage"->fighting?"frost":null;
            case "healer","farmer"->!fighting?"mend":null;
            case "artisan"->!fighting&&maid.getBrain().hasMemoryValue(MemoryModuleType.WALK_TARGET)&&!maid.getTask().getUid().toString().equals("touhou_little_maid:idle")?"haste":null;
            default->null;};
        if(skill==null)return;
        try{var receipt=new LinkedHashMap<>(ResidentRpg.cast(maid,role.profession(),skill,residents.allies(maid)));receipt.put("observedAt",java.time.Instant.now().toString());s.skill=receipt;}
        catch(IllegalArgumentException normal){/* Cooldown, no injured ally, mana and protection refusal are ordinary game results. */}
    }
    void damaged(EntityMaid maid,LivingEntity target,float damage,boolean projectile){
        if(damage<=0)return;var s=states.computeIfAbsent(maid.getUUID(),k->new State());s.hits++;s.lastHit=ResidentRpg.now(maid);
        s.hit=Map.of("targetId",target.getStringUUID(),"type",BuiltInRegistries.ENTITY_TYPE.getKey(target.getType()).toString(),
            "damage",damage,"projectile",projectile,"position",ResidentActions.point(target.blockPosition()),"observedAt",java.time.Instant.now().toString());
    }
}
