package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.JsonObject;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.ai.behavior.BehaviorUtils;
import net.minecraft.world.entity.ai.behavior.EntityTracker;
import net.minecraft.world.entity.ai.memory.MemoryModuleType;
import org.bukkit.Bukkit;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import java.util.*;

/** Main-thread bridge over the original navigation. No world scans, model calls or chunk loads. */
public final class NativeMaidFollowSupport {
    private final MaidFollowPolicy policy=new MaidFollowPolicy();
    private final Map<UUID,String> last=new HashMap<>();
    private static LivingEntity owner(EntityMaid maid){
        var id=maid.getOwnerUUID();var player=id==null?null:Bukkit.getPlayer(id);
        return player instanceof CraftPlayer craft?craft.getHandle():maid.getOwner();
    }
    private static String pause(EntityMaid maid,LivingEntity owner){
        if(!maid.isAlive()||maid.isRemoved())return "maid_unavailable";
        if(maid.isMaidInSittingPose())return "sitting";
        if(maid.isHomeModeEnable())return "home_mode";
        if(maid.isNoAi()||!maid.canBrainMoving())return "movement_paused";
        if(!maid.getTask().getUid().toString().equals("touhou_little_maid:idle")||maid.getTarget()!=null)return "native_work_or_combat";
        if(maid.getSwimManager().isGoingToBreath())return "native_breathing";
        if(owner==null||owner.isRemoved()||owner.isDeadOrDying()||owner.isSpectator())return "owner_unavailable";
        if(owner.level()!=maid.level())return "different_dimension";
        return "";
    }
    public void tick(EntityMaid maid){
        UUID id=maid.getUUID();LivingEntity owner=owner(maid);String reason=pause(maid,owner);
        if(!reason.isEmpty()){policy.clear(id);last.remove(id);return;}
        var decision=policy.observe(id,new MaidFollowPolicy.Point(maid.getX(),maid.getY(),maid.getZ()),new MaidFollowPolicy.Point(owner.getX(),owner.getY(),owner.getZ()),System.nanoTime());
        if(decision==MaidFollowPolicy.Action.RECOVER){
            boolean moved=maid.teleportToOwner(owner);
            if(moved){maid.getNavigationManager().resetNavigation();maid.getBrain().eraseMemory(MemoryModuleType.WALK_TARGET);}
            last.put(id,moved?"native_safe_recovery":"no_safe_landing");
        }else if(decision==MaidFollowPolicy.Action.WALK){
            var target=maid.getBrain().getMemory(MemoryModuleType.WALK_TARGET);
            if(target.isEmpty()||!(target.get().getTarget() instanceof EntityTracker tracker)||tracker.getEntity()!=owner)
                BehaviorUtils.setWalkAndLookTargetMemories(maid,owner,0.5F,2);
            if(!"no_safe_landing".equals(last.get(id)))last.put(id,"walk_requested");
        }else last.put(id,"within_follow_distance");
    }
    public void unavailable(UUID id){policy.clear(id);last.remove(id);}
    public void retain(Set<UUID> ids){policy.retain(ids);last.keySet().retainAll(ids);}
    public JsonObject describe(EntityMaid maid){
        LivingEntity owner=owner(maid);String reason=pause(maid,owner);JsonObject out=new JsonObject();
        out.addProperty("policy","close_idle_companion");out.addProperty("active",reason.isEmpty());
        out.addProperty("state",reason.isEmpty()?last.getOrDefault(maid.getUUID(),"awaiting_native_tick"):reason);
        out.addProperty("walkBeyond",3);out.addProperty("stopWithin",2);out.addProperty("stuckSeconds",8);out.addProperty("recoveryCooldownSeconds",15);
        out.addProperty("meaning","模式已设置不等于已走到身边；读取实际位置和ownerDistance。卡路时仅尝试原模组安全落点，不破坏地形。");
        if(reason.equals("different_dimension"))out.addProperty("nextStep","主人与女仆不在同一维度；先通过正常传送入口会合，再查询，不按相似坐标判断在附近。");
        if(reason.equals("native_work_or_combat"))out.addProperty("nextStep","当前工作或战斗由原生AI处理；闲置且非停留状态时才启用近距陪伴。");
        return out;
    }
}
