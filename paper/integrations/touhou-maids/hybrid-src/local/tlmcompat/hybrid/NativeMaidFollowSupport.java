package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.config.subconfig.MaidConfig;
import com.google.gson.JsonObject;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.ai.behavior.BehaviorUtils;
import net.minecraft.world.entity.ai.behavior.EntityTracker;
import net.minecraft.world.entity.ai.memory.MemoryModuleType;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.Tag;
import org.bukkit.Bukkit;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import java.util.*;

/** Main-thread bridge over the original navigation. No world scans, model calls or chunk loads. */
public final class NativeMaidFollowSupport {
    private final MaidFollowPolicy policy=new MaidFollowPolicy();
    private final Map<UUID,String> last=new HashMap<>();
    private final Map<UUID,Limits> applied=new HashMap<>();
    public static final String PROFILE="qiandengji_follow";
    public record Limits(int walkBeyond,int stopWithin,int recoverBeyond,boolean customized){
        public Limits{if(walkBeyond<3||stopWithin<2||stopWithin>=walkBeyond||recoverBeyond<walkBeyond||recoverBeyond>256)throw new IllegalArgumentException("Invalid following profile");}
        int nativeRange(){return recoverBeyond-2;}
    }
    private static final Limits DEFAULT=new Limits(3,2,3,false);
    private static final int GUARD_WALK = 4, GUARD_STOP = 3;
    public static Limits limits(EntityMaid maid){
        CompoundTag data=maid.getPersistentData();if(!data.contains(PROFILE))return DEFAULT;
        if(!data.contains(PROFILE,Tag.TAG_COMPOUND))throw new IllegalArgumentException("Invalid following profile");
        CompoundTag p=data.getCompound(PROFILE);
        for(String field:List.of("schemaVersion","walkDistance","stopDistance","returnDistance"))if(!p.contains(field,Tag.TAG_INT))throw new IllegalArgumentException("Following profile requires integer "+field);
        if(p.getInt("schemaVersion")!=1)throw new IllegalArgumentException("Unsupported following profile version");
        int walk=p.getInt("walkDistance"),stop=p.getInt("stopDistance"),recover=p.getInt("returnDistance");
        if(recover<walk+4)throw new IllegalArgumentException("Native following recovery needs a four-block margin");
        return new Limits(walk,stop,recover,true);
    }
    public static void applyNativeRange(EntityMaid maid){
        Limits limits=limits(maid);
        if(limits.customized()&&!maid.isHomeModeEnable()&&maid.getRestrictRadius()!=limits.nativeRange())
            maid.restrictTo(net.minecraft.core.BlockPos.ZERO,limits.nativeRange());
    }
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
    public void tick(EntityMaid maid, boolean closingIn){
        MaidCompanionActions.expireWait(maid,System.currentTimeMillis());
        UUID id=maid.getUUID();LivingEntity owner=owner(maid);String reason=pause(maid,owner);
        if(!reason.isEmpty()){policy.clear(id);last.remove(id);return;}
        Limits limits;
        try{limits=limits(maid);}catch(IllegalArgumentException invalid){policy.clear(id);last.put(id,"follow_profile_invalid");return;}
        Limits previous=applied.put(id,limits);
        if(!limits.equals(previous)){
            policy.clear(id);
            if(previous!=null&&previous.customized()&&!limits.customized()&&maid.getRestrictRadius()==previous.nativeRange())
                maid.restrictTo(net.minecraft.core.BlockPos.ZERO,MaidConfig.MAID_NON_HOME_RANGE.get());
            // Release only an old automatic owner-follow target, never an Agent's work target.
            var target=maid.getBrain().getMemory(MemoryModuleType.WALK_TARGET);
            if(limits.customized()&&target.isPresent()&&target.get().getTarget() instanceof EntityTracker tracker&&tracker.getEntity()==owner){maid.getBrain().eraseMemory(MemoryModuleType.WALK_TARGET);maid.getNavigationManager().resetNavigation();}
        }
        applyNativeRange(maid);
        int walk = closingIn ? GUARD_WALK : limits.walkBeyond();
        int stop = closingIn ? GUARD_STOP : limits.stopWithin();
        var decision=policy.observe(id,new MaidFollowPolicy.Point(maid.getX(),maid.getY(),maid.getZ()),new MaidFollowPolicy.Point(owner.getX(),owner.getY(),owner.getZ()),System.nanoTime(),walk,Math.max(walk, limits.recoverBeyond()));
        if(decision==MaidFollowPolicy.Action.RECOVER){
            boolean moved=maid.teleportToOwner(owner);
            if(moved){maid.getNavigationManager().resetNavigation();maid.getBrain().eraseMemory(MemoryModuleType.WALK_TARGET);}
            last.put(id,moved?"native_safe_recovery":"no_safe_landing");
        }else if(decision==MaidFollowPolicy.Action.WALK){
            var target=maid.getBrain().getMemory(MemoryModuleType.WALK_TARGET);
            if(target.isEmpty()||!(target.get().getTarget() instanceof EntityTracker tracker)||tracker.getEntity()!=owner||target.get().getCloseEnoughDist()!=stop)
                BehaviorUtils.setWalkAndLookTargetMemories(maid,owner,0.5F,stop);
            if(!"no_safe_landing".equals(last.get(id)))last.put(id,"walk_requested");
        }else last.put(id,"within_follow_distance");
    }
    public void unavailable(UUID id){policy.clear(id);last.remove(id);applied.remove(id);}
    public void retain(Set<UUID> ids){policy.retain(ids);last.keySet().retainAll(ids);applied.keySet().retainAll(ids);}
    public JsonObject describe(EntityMaid maid){
        LivingEntity owner=owner(maid);String reason=pause(maid,owner);JsonObject out=new JsonObject();
        Limits limits;
        try{limits=limits(maid);}catch(IllegalArgumentException invalid){out.addProperty("active",false);out.addProperty("state","follow_profile_invalid");out.addProperty("nextStep","请服主核对该女仆的跟随距离配置；不要反复重发follow。");return out;}
        out.addProperty("policy",limits.customized()?"ranged_idle_companion":"close_idle_companion");out.addProperty("active",reason.isEmpty());
        out.addProperty("state",reason.isEmpty()?last.getOrDefault(maid.getUUID(),"awaiting_native_tick"):reason);
        out.addProperty("walkBeyond",limits.walkBeyond());out.addProperty("stopWithin",limits.stopWithin());out.addProperty("recoveryBeyond",limits.recoverBeyond());out.addProperty("distanceUnit","blocks");out.addProperty("stuckSeconds",8);out.addProperty("recoveryCooldownSeconds",15);out.addProperty("customized",limits.customized());
        out.addProperty("meaning","模式已设置不等于已走到身边；读取实际位置和ownerDistance。卡路时仅尝试原模组安全落点，不破坏地形。");
        out.addProperty("temporaryWait",MaidCompanionActions.waiting(maid));
        out.addProperty("waitUntilEpochMillis",maid.getPersistentData().getLong(MaidCompanionActions.WAIT));
        if(reason.equals("sitting")||reason.equals("home_mode"))out.addProperty("nextStep",MaidCompanionActions.waiting(maid)?"短暂停等结束后自动恢复跟随。":"当前处于驻守。可以在同维度近处说“肥鱼，跟我走”，也可用 /qdmaid follow <maidId> <新requestId> 立即切换。");
        if(reason.equals("different_dimension"))out.addProperty("nextStep","伙伴与女仆不在同一维度；可用 /qdmaid recall 召回，随后核对实际维度和位置。");
        if(reason.equals("native_work_or_combat"))out.addProperty("nextStep","当前工作或战斗由原生AI处理；闲置且非停留状态时才启用近距陪伴。");
        return out;
    }
}
