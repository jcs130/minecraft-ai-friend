package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.api.task.IAttackTask;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskAttack;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskBowAttack;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskCrossBowAttack;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskDanmakuAttack;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskManager;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskTridentAttack;
import com.github.tartaricacid.touhoulittlemaid.init.InitEntities;
import com.google.gson.JsonObject;
import java.util.*;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.NeutralMob;
import net.minecraft.world.entity.monster.Enemy;
import net.minecraft.world.entity.schedule.Activity;
import net.minecraft.world.entity.ai.memory.MemoryModuleType;
import org.bukkit.Bukkit;

/** Original configured companion only, checked once a second over nearby loaded mobs. */
final class NativeMaidCompanionSupport implements AutoCloseable {
    private static final String TAG="qiandengji_auto_defence_task";
    private static final List<ResourceLocation> ATTACK_TASKS=List.of(
        TaskBowAttack.UID,TaskCrossBowAttack.UID,TaskDanmakuAttack.UID,TaskTridentAttack.UID);
    private static final Set<String> AMMUNITION_CONDITIONS=Set.of("has_arrow","has_ammunition");
    private final HybridMaidPlugin plugin;
    private final Map<UUID,Long> lastThreat=new HashMap<>();
    private final Map<UUID,String> states=new HashMap<>();
    private final java.util.function.Consumer<com.github.tartaricacid.touhoulittlemaid.api.event.MaidHurtTarget.Pre> beforeMelee;
    private final java.util.function.Consumer<net.neoforged.neoforge.event.entity.living.LivingIncomingDamageEvent> beforeDamage;
    NativeMaidCompanionSupport(HybridMaidPlugin plugin){
        this.plugin=plugin;
        beforeMelee=event->{var maid=event.getMaid();var attack=activeGuard(maid);if(attack!=null&&!allowed(maid,event.getTarget(),attack)){event.setCanceled(true);clearTarget(maid);}};
        beforeDamage=event->{if(event.getSource().getEntity() instanceof EntityMaid maid){var attack=activeGuard(maid);if(attack!=null&&!allowed(maid,event.getEntity(),attack))event.setCanceled(true);}};
        // Native target selection is broader than automatic companion vigilance. Revalidate
        // melee and ranged/sweep damage without replacing tasks or any other maid's AI.
        var bus=net.neoforged.neoforge.common.NeoForge.EVENT_BUS;
        bus.addListener(net.neoforged.bus.api.EventPriority.HIGHEST,false,beforeMelee);
        bus.addListener(net.neoforged.bus.api.EventPriority.HIGHEST,false,beforeDamage);
    }
    @Override public void close(){var bus=net.neoforged.neoforge.common.NeoForge.EVENT_BUS;bus.unregister(beforeMelee);bus.unregister(beforeDamage);}
    private IAttackTask activeGuard(EntityMaid maid){
        return plugin.sharedDialogueEnabled(maid)&&maid.getTask() instanceof IAttackTask attack
            &&maid.getPersistentData().getString(TAG).equals(attack.getUid().toString())?attack:null;
    }
    private boolean allowed(EntityMaid maid,net.minecraft.world.entity.Entity entity,IAttackTask armed){
        if(!(entity instanceof Mob mob)||armed==null||!mob.isAlive())return false;
        var target=mob.getTarget();boolean attacking=target!=null&&(target==maid||target.getUUID().equals(maid.getOwnerUUID()));
        return MaidCompanionPolicy.hostileCandidate(attacking,mob instanceof Enemy,mob instanceof NeutralMob,maid.isAlliedTo(mob),
            !mob.isNoAi()&&!mob.isInvulnerable()&&!mob.getBukkitEntity().hasMetadata("NPC"),maid.hasLineOfSight(mob),maid.distanceToSqr(mob)<=64,armed.canAttack(maid,mob));
    }
    private void clearTarget(EntityMaid maid){maid.getBrain().eraseMemory(MemoryModuleType.ATTACK_TARGET);maid.getBrain().eraseMemory(MemoryModuleType.WALK_TARGET);maid.getBrain().eraseMemory(MemoryModuleType.PATH);}
    static IAttackTask weaponTask(EntityMaid maid){
        for(ResourceLocation id:ATTACK_TASKS){
            var task=TaskManager.getTaskMap().get(id);
            if(task instanceof IAttackTask attack&&task.isEnable(maid)&&attack.isWeapon(maid,maid.getMainHandItem())){
                boolean ready=task.getConditionDescription(maid).stream().filter(c->AMMUNITION_CONDITIONS.contains(c.getFirst()))
                    .allMatch(c->c.getSecond().test(maid));
                return ready?attack:null;
            }
        }
        var melee=TaskManager.getTaskMap().get(TaskAttack.UID);
        return melee instanceof IAttackTask attack&&melee.isEnable(maid)&&attack.isWeapon(maid,maid.getMainHandItem())?attack:null;
    }
    private static int partnerRange(EntityMaid maid){
        try{return Math.max(16,NativeMaidFollowSupport.limits(maid).stopWithin()+8);}
        catch(IllegalArgumentException invalid){return 16;}
    }
    void manual(EntityMaid maid){
        // Follow/stay must also exit our temporary combat task, not leave a hidden attack mode.
        if(maid.getPersistentData().getString(TAG).equals(maid.getTask().getUid().toString()))maid.setTask(TaskManager.getIdleTask());
        maid.getPersistentData().remove(TAG);lastThreat.remove(maid.getUUID());states.remove(maid.getUUID());
    }
    void tick(EntityMaid maid){
        if(!plugin.sharedDialogueEnabled(maid))return;
        UUID id=maid.getUUID();String task=maid.getTask().getUid().toString();
        var data=maid.getPersistentData();boolean automatic=!data.getString(TAG).isEmpty()&&data.getString(TAG).equals(task);
        if(!data.getString(TAG).isEmpty()&&!automatic){data.remove(TAG);lastThreat.remove(id);}
        var owner=maid.getOwnerUUID()==null?null:Bukkit.getPlayer(maid.getOwnerUUID());
        double ownerRange=partnerRange(maid);
        boolean eligible=owner!=null&&owner.isOnline()&&!owner.isDead()&&owner.getGameMode()!=org.bukkit.GameMode.SPECTATOR
            &&owner.getWorld().equals(maid.getBukkitEntity().getWorld())&&owner.getLocation().distanceSquared(maid.getBukkitEntity().getLocation())<=ownerRange*ownerRange
            &&maid.isAlive()&&!maid.isRemoved()&&!maid.isNoAi()&&!maid.isMaidInSittingPose()&&!maid.isHomeModeEnable()&&!maid.isSleeping()&&maid.canBrainMoving();
        IAttackTask armed=weaponTask(maid);Mob nearest=null;
        if(eligible&&armed!=null)for(Mob mob:maid.level().getEntitiesOfClass(Mob.class,maid.getBoundingBox().inflate(8),m->m.isAlive()&&m!=maid)){
            if(allowed(maid,mob,armed)&&(nearest==null||maid.distanceToSqr(mob)<maid.distanceToSqr(nearest)))nearest=mob;
        }
        boolean threat=nearest!=null;
        long now=System.nanoTime();if(threat)lastThreat.put(id,now);
        // A persisted temporary task is re-evaluated after restart, never replayed as a command.
        long quiet=lastThreat.containsKey(id)?now-lastThreat.get(id):Long.MAX_VALUE;
        boolean low=maid.getHealth()<=maid.getMaxHealth()*0.3F;
        boolean idle=task.equals(MaidCompanionActions.IDLE);
        var action=MaidCompanionPolicy.choose(eligible,automatic,idle,low,armed!=null,threat,quiet);
        if(action==MaidCompanionPolicy.Action.DEFEND||automatic&&action==MaidCompanionPolicy.Action.HOLD&&!task.equals(armed.getUid().toString())){
            data.putString(TAG,armed.getUid().toString());maid.setTask(armed);automatic=true;
        }
        else if(action==MaidCompanionPolicy.Action.RESTORE){maid.setTask(TaskManager.getIdleTask());data.remove(TAG);lastThreat.remove(id);automatic=false;}
        if(automatic){
            // Native attack behaviours belong to WORK, not the maid's nighttime REST activity.
            // Override only this temporary brain; setTask/restore rebuilds the original schedule.
            // Never change the owner's saved MaidSchedule or wake a sleeping/stationed maid.
            maid.getBrain().setSchedule(InitEntities.MAID_ALL_DAY_SCHEDULES.get());
            maid.getBrain().setActiveActivityIfPossible(Activity.WORK);
            if(nearest!=null)maid.getBrain().setMemory(MemoryModuleType.ATTACK_TARGET,nearest);
            else if(maid.getTarget()!=null&&!allowed(maid,maid.getTarget(),armed))clearTarget(maid);
        }
        states.put(id,!eligible?"paused_by_owner_or_world":low?"recovering_near_owner":automatic?"native_defence":!idle&&action!=MaidCompanionPolicy.Action.RESTORE?"owner_selected_task":armed==null?"following_needs_weapon":"following_ready");
    }
    JsonObject describe(EntityMaid maid){
        JsonObject out=new JsonObject();out.addProperty("enabled",plugin.sharedDialogueEnabled(maid));
        out.addProperty("state",states.getOrDefault(maid.getUUID(),"awaiting_native_tick"));
        out.addProperty("automaticTask",maid.getPersistentData().getString(TAG));
        var armed=weaponTask(maid);
        if(armed!=null)out.addProperty("equippedAttackTask",armed.getUid().toString());
        out.add("mainHand",HybridMaidPlugin.item(maid.getMainHandItem()));
        out.addProperty("partnerRange",partnerRange(maid));
        out.addProperty("meaning","闲置跟随且持有合用武器时，主动处理8格内可见的敌对怪物，也保护主人和自己；不主动攻击和平中立生物、友方、NPC或停用AI的装饰实体。脱战5秒或低血量恢复陪伴，停留、驻守、睡眠和手选工作优先。未自动领装备、未确认击杀。");
        out.addProperty("nextStep",armed==null?"随行护卫需要主手武器。可用 inventory/equip 装备近战武器，弓弩还需原生弹药。":"护卫需要伙伴在线同维度且在范围内。驻守、坐下或手选工作时，请先结束工作并恢复随行。");return out;
    }
}
