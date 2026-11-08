package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.api.task.IAttackTask;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskManager;
import com.google.gson.JsonObject;
import java.util.*;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.entity.Mob;
import org.bukkit.Bukkit;

/** Original configured companion only, checked once a second over nearby loaded mobs. */
final class NativeMaidCompanionSupport {
    private static final String TAG="qiandengji_auto_defence_task";
    private static final String IDLE="touhou_little_maid:idle";
    private final HybridMaidPlugin plugin;
    private final Map<UUID,Long> lastThreat=new HashMap<>();
    private final Map<UUID,String> states=new HashMap<>();
    NativeMaidCompanionSupport(HybridMaidPlugin plugin){this.plugin=plugin;}
    private IAttackTask weaponTask(EntityMaid maid){
        for(String name:List.of("attack","range_attack","danmaku_attack")){
            var task=TaskManager.getTaskMap().get(ResourceLocation.parse("touhou_little_maid:"+name));
            if(task instanceof IAttackTask attack&&task.isEnable(maid)&&attack.isWeapon(maid,maid.getMainHandItem()))return attack;
        }return null;
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
        boolean eligible=owner!=null&&owner.isOnline()&&!owner.isDead()&&owner.getGameMode()!=org.bukkit.GameMode.SPECTATOR
            &&owner.getWorld().equals(maid.getBukkitEntity().getWorld())&&owner.getLocation().distanceSquared(maid.getBukkitEntity().getLocation())<=256
            &&maid.isAlive()&&!maid.isRemoved()&&!maid.isNoAi()&&!maid.isMaidInSittingPose()&&!maid.isHomeModeEnable()&&!maid.isSleeping()&&maid.canBrainMoving();
        IAttackTask armed=weaponTask(maid);boolean threat=false;
        if(eligible&&armed!=null)for(Mob mob:maid.level().getEntitiesOfClass(Mob.class,maid.getBoundingBox().inflate(8),m->m.isAlive()&&m!=maid)){
            var target=mob.getTarget();
            // Home restrictions apply to stationed work. This branch is explicitly following its owner.
            if(target!=null&&(target==maid||target.getUUID().equals(maid.getOwnerUUID()))&&maid.hasLineOfSight(mob)&&armed.canAttack(maid,mob)){threat=true;break;}
        }
        long now=System.nanoTime();if(threat)lastThreat.put(id,now);
        // A persisted temporary task is re-evaluated after restart, never replayed as a command.
        long quiet=lastThreat.containsKey(id)?now-lastThreat.get(id):Long.MAX_VALUE;
        boolean low=maid.getHealth()<=maid.getMaxHealth()*0.3F;
        var action=MaidCompanionPolicy.choose(eligible,automatic,task.equals(IDLE),low,armed!=null,threat,quiet);
        if(action==MaidCompanionPolicy.Action.DEFEND){data.putString(TAG,armed.getUid().toString());maid.setTask(armed);automatic=true;}
        else if(action==MaidCompanionPolicy.Action.RESTORE){maid.setTask(TaskManager.getIdleTask());data.remove(TAG);lastThreat.remove(id);automatic=false;}
        states.put(id,!eligible?"paused_by_owner_or_world":low?"recovering_near_owner":automatic?"native_defence":!task.equals(IDLE)&&action!=MaidCompanionPolicy.Action.RESTORE?"owner_selected_task":armed==null?"following_needs_weapon":"following_ready");
    }
    JsonObject describe(EntityMaid maid){
        JsonObject out=new JsonObject();out.addProperty("enabled",plugin.sharedDialogueEnabled(maid));
        out.addProperty("state",states.getOrDefault(maid.getUUID(),"awaiting_native_tick"));
        out.addProperty("automaticTask",maid.getPersistentData().getString(TAG));
        out.addProperty("meaning","闲置跟随时，附近可见怪物正在攻击主人或本人且主手武器符合原生条件，自动切换原生战斗；脱战5秒或低血量恢复陪伴。主人停留、驻守、睡眠和手选工作优先。未自动领装备、未确认击杀。");
        out.addProperty("nextStep","装备请用原菜单或 inventory/equip；聊天先点名，收到回复后45秒内可直接接话。工作和动作以 task、follow、stay 的真实回执为准。");return out;
    }
}
