package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import java.util.*;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.ai.memory.MemoryModuleType;
import net.minecraft.world.phys.Vec3;

/** Called only after a current conversation accepts the verified speaker's invitation. */
final class ResidentTravel {
    record Plan(UUID maid,ServerLevel world,BlockPos landing,String fromDimension,Vec3 from,long preparedAt,String reason) {
        Map<String,Object> evidence(){return Map.of("maidId",maid.toString(),"fromDimension",fromDimension,"dimension",world.dimension().location().toString(),
            "from",Map.of("x",from.x,"y",from.y,"z",from.z),"landing",ResidentActions.point(landing),"manaCost",5,"cooldownMs",60000);}
    }
    static Map<String,Object> visit(EntityMaid maid,LivingEntity partner) {
        return execute(maid,prepareVisit(maid,partner));
    }
    static Plan prepareVisit(EntityMaid maid,LivingEntity partner) {
        if(!partner.isAlive()||partner.isSpectator())throw new IllegalArgumentException("travel_partner_unavailable");
        return prepare(maid,(ServerLevel)partner.level(),partner.blockPosition(),partner,"consented_arrival_verified");
    }
    static Map<String,Object> home(EntityMaid maid,ServerLevel world,BlockPos home) {
        return execute(maid,prepareHome(maid,world,home));
    }
    static Plan prepareHome(EntityMaid maid,ServerLevel world,BlockPos home) {
        return prepare(maid,world,home,null,"own_home_arrival_verified");
    }
    private static Plan prepare(EntityMaid maid,ServerLevel world,BlockPos target,LivingEntity partner,String reason) {
        if(!maid.isAlive()||world==null||maid.isPassenger()||maid.isVehicle()||maid.isLeashed()||maid.guiOpening)
            throw new IllegalArgumentException("travel_body_unavailable");
        var d=ResidentRpg.data(maid);long now=System.currentTimeMillis();
        if(d.getLong("travelAfter")>now)throw new IllegalArgumentException("travel_cooldown");
        if(d.getDouble("mana")<5)throw new IllegalArgumentException("travel_mana_low");
        BlockPos landing=null;
        // Stable nearest first, loaded safe floor and body-sized clearance. No chunk generation or block changes.
        for(int radius=2;radius<=4&&landing==null;radius++)for(int x=-radius;x<=radius&&landing==null;x++)for(int z=-radius;z<=radius&&landing==null;z++) {
            if(Math.max(Math.abs(x),Math.abs(z))!=radius)continue;
            for(int y:new int[]{0,1,-1}) {
                var p=target.offset(x,y,z);var at=Vec3.atBottomCenterOf(p);
                if(!world.hasChunkAt(p)||!world.getWorldBorder().isWithinBounds(p)||!world.getBlockState(p.below()).isFaceSturdy(world,p.below(),net.minecraft.core.Direction.UP)
                    ||!world.getFluidState(p).isEmpty()||!world.getFluidState(p.above()).isEmpty()
                    ||world.getBlockState(p.below()).is(net.minecraft.world.level.block.Blocks.MAGMA_BLOCK)
                    ||world.getBlockState(p).is(net.minecraft.world.level.block.Blocks.FIRE)
                    ||!world.noCollision(maid,maid.getBoundingBox().move(at.subtract(maid.position()))))continue;
                if(partner!=null&&!hybridAllowed(maid,partner,world,p)||!"allow_likely".equals(ResidentProtection.query(maid,world,"use",p).get("status")))continue;
                landing=p;break;
            }
        }
        if(landing==null)throw new IllegalArgumentException("travel_no_permitted_safe_landing");
        return new Plan(maid.getUUID(),world,landing,maid.level().dimension().location().toString(),maid.position(),now,reason);
    }
    static Map<String,Object> execute(EntityMaid maid,Plan plan) {
        long now=System.currentTimeMillis();
        if(!maid.getUUID().equals(plan.maid())||!maid.isAlive()||!maid.level().dimension().location().toString().equals(plan.fromDimension())
            ||maid.position().distanceToSqr(plan.from())>.25||now-plan.preparedAt()>5000)throw new IllegalArgumentException("travel_plan_changed_read_again");
        var before=maid.position();String dimension=plan.fromDimension();var origin=(ServerLevel)maid.level();var world=plan.world();var landing=plan.landing();
        var at=Vec3.atBottomCenterOf(landing);maid.getNavigation().stop();maid.getBrain().eraseMemory(MemoryModuleType.WALK_TARGET);
        if(!maid.teleportTo(world,at.x,at.y,at.z,Set.of(),maid.getYRot(),maid.getXRot()))throw new IllegalArgumentException("travel_refused");
        // Cross-dimension teleport can replace the native entity object; reconcile the original UUID, never spawn a new identity.
        var arrived=world.getEntity(maid.getUUID());
        if(!(arrived instanceof EntityMaid current)||current.position().distanceToSqr(at)>4)throw new IllegalStateException("travel_result_unknown_query_original");
        var mana=ResidentRpg.data(current);mana.putDouble("mana",Math.max(0,mana.getDouble("mana")-5));mana.putLong("travelAfter",now+60000);
        origin.sendParticles(ParticleTypes.PORTAL,before.x,before.y+1,before.z,24,.4,.7,.4,.1);
        world.sendParticles(ParticleTypes.PORTAL,at.x,at.y+1,at.z,24,.4,.7,.4,.1);
        world.playSound(null,landing,net.minecraft.sounds.SoundEvents.ENDERMAN_TELEPORT,net.minecraft.sounds.SoundSource.NEUTRAL,.8f,1);
        return Map.of("status","completed","completed",true,"reason",plan.reason(),"maidId",current.getStringUUID(),
            "fromDimension",dimension,"dimension",world.dimension().location().toString(),"actualPosition",ResidentActions.point(current.blockPosition()),"manaSpent",5,"cooldownMs",60000);
    }
    private static boolean hybridAllowed(EntityMaid maid,LivingEntity partner,ServerLevel world,BlockPos at) {
        Class<?> bukkit;try{bukkit=Class.forName("org.bukkit.Bukkit");}catch(ClassNotFoundException stock){return true;}
        try{
            var pm=bukkit.getMethod("getPluginManager").invoke(null);
            var plugin=Class.forName("org.bukkit.plugin.PluginManager").getMethod("getPlugin",String.class).invoke(pm,"AgentFriend");if(plugin==null)return false;
            Object speaker=partner.getClass().getMethod("getBukkitEntity").invoke(partner);
            var location=Class.forName("org.bukkit.Location");var entity=Class.forName("org.bukkit.entity.Entity");
            Object target=entity.getMethod("getLocation").invoke(speaker);
            var access=plugin.getClass().getClassLoader().loadClass("org.afuhome.agentfriend.CompanionTravelAccess");
            return Boolean.TRUE.equals(access.getMethod("mayInviteResidentEntity",entity,location).invoke(null,speaker,target));
        }catch(ReflectiveOperationException|LinkageError failure){return false;}
    }
}
