package dev.qiandeng.maw;

import com.google.gson.*;
import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.level.BlockEvent;
import net.neoforged.neoforge.event.level.ExplosionEvent;
import net.neoforged.neoforge.event.level.PistonEvent;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;
import java.time.Instant;
import java.util.*;

/** Same checks for Java, Bedrock, Mineflayer and Numen, with native Colony permissions. */
final class RpgProtection {
    static void register(){
        NeoForge.EVENT_BUS.addListener((BlockEvent.BreakEvent e)->{if(e.getPlayer() instanceof ServerPlayer p&&!allowed(p,"break",e.getPos()))e.setCanceled(true);});
        NeoForge.EVENT_BUS.addListener((BlockEvent.EntityPlaceEvent e)->{if(e.getEntity() instanceof ServerPlayer p&&!allowed(p,"place",e.getPos()))e.setCanceled(true);});
        NeoForge.EVENT_BUS.addListener((BlockEvent.EntityMultiPlaceEvent e)->{if(e.getEntity() instanceof ServerPlayer p&&e.getReplacedBlockSnapshots().stream().anyMatch(s->!allowed(p,"place",s.getPos())))e.setCanceled(true);});
        NeoForge.EVENT_BUS.addListener((PlayerInteractEvent.RightClickBlock e)->{if(e.getEntity() instanceof ServerPlayer p&&!allowed(p,"use",e.getPos())){e.setCanceled(true);e.setCancellationResult(net.minecraft.world.InteractionResult.FAIL);}});
        NeoForge.EVENT_BUS.addListener((PlayerInteractEvent.LeftClickBlock e)->{if(e.getEntity() instanceof ServerPlayer p&&!allowed(p,"break",e.getPos()))e.setCanceled(true);});
        NeoForge.EVENT_BUS.addListener((ExplosionEvent.Detonate e)->{e.getAffectedBlocks().removeIf(pos->environmentProtected(e.getLevel(),pos));});
        NeoForge.EVENT_BUS.addListener((BlockEvent.FluidPlaceBlockEvent e)->{if(e.getLevel() instanceof Level l&&environmentProtected(l,e.getPos())&&claim(l,e.getPos())!=claim(l,e.getLiquidPos()))e.setCanceled(true);});
        NeoForge.EVENT_BUS.addListener((PistonEvent.Pre e)->{if(!(e.getLevel() instanceof Level l))return;var direction=e.getDirection();for(int n=0;n<=13;n++)if(environmentProtected(l,e.getPos().relative(direction,n))){e.setCanceled(true);break;}});
    }
    static boolean environmentProtected(Level level,BlockPos pos){return level.getServer()!=null&&(level.dimension().location().toString().equals("maw:trials")||claim(level,pos)!=null);}
    static JsonObject claim(Level level,BlockPos pos){
        for(var e:RpgStore.of(level.getServer()).root.getAsJsonObject("claims").entrySet()){JsonObject c=e.getValue().getAsJsonObject();if(c.get("dimension").getAsString().equals(level.dimension().location().toString())&&inside(c,pos))return c;}
        return null;
    }
    private static boolean inside(JsonObject c,BlockPos p){JsonObject a=c.getAsJsonObject("min"),b=c.getAsJsonObject("max");return p.getX()>=a.get("x").getAsInt()&&p.getX()<=b.get("x").getAsInt()&&p.getY()>=a.get("y").getAsInt()&&p.getY()<=b.get("y").getAsInt()&&p.getZ()>=a.get("z").getAsInt()&&p.getZ()<=b.get("z").getAsInt();}
    private static boolean member(ServerPlayer p,JsonObject c){return c.get("ownerUuid").getAsString().equals(p.getUUID().toString())||c.getAsJsonArray("members").contains(new JsonPrimitive(p.getUUID().toString()));}
    static boolean allowed(ServerPlayer p,String action,BlockPos pos){return query(p,action,pos).get("status").getAsString().equals("allow_likely");}
    static JsonObject query(ServerPlayer p,String action,BlockPos pos){
        if(!Set.of("break","place","use").contains(action))throw new IllegalArgumentException("invalid_protection_action");
        JsonObject r=new JsonObject();r.addProperty("schemaVersion",1);r.addProperty("playerUuid",p.getUUID().toString());r.addProperty("bodyId",p.getUUID().toString());r.addProperty("sampledAt",Instant.now().toString());r.addProperty("action",action);r.addProperty("dimension",p.level().dimension().location().toString());r.add("position",ModRequest.position(pos));
        String code="no_known_denial",status="allow_likely";JsonObject claim=claim(p.level(),pos);
        if(!p.level().isLoaded(pos)){status="unknown";code="chunk_not_loaded";}
        else if(p.level().dimension().location().toString().equals("maw:trials")&&!action.equals("use")){status="deny";code="trial_structure";}
        else if(claim!=null&&!member(p,claim)&&!(action.equals("use")&&claim.get("visitorUse").getAsBoolean()&&p.level().getBlockEntity(pos)==null)){status="deny";code="private_land";}
        else {
            var colony=com.minecolonies.api.colony.IColonyManager.getInstance().getColonyByPosFromWorld(p.level(),pos);
            if(colony!=null){var nativeAction=switch(action){case "break"->com.minecolonies.api.colony.permissions.Action.BREAK_BLOCKS;case "place"->com.minecolonies.api.colony.permissions.Action.PLACE_BLOCKS;default->com.minecolonies.api.colony.permissions.Action.ACCESS_HUTS;};if(!colony.getPermissions().hasPermission(p,nativeAction)){status="deny";code="colony_permission_denied";}}
            if(status.equals("allow_likely")&&!p.level().mayInteract(p,pos)){status="deny";code="native_world_protection";}
        }
        if(claim!=null){r.addProperty("landId",claim.get("id").getAsString());r.addProperty("ownerUuid",claim.get("ownerUuid").getAsString());}
        r.addProperty("status",status);r.addProperty("reason",code);r.addProperty("canBreak",action.equals("break")&&status.equals("allow_likely"));r.addProperty("authoritativeForKnownRules",!status.equals("unknown"));r.addProperty("otherModsMayDeny",true);return r;
    }
    static JsonObject list(ServerPlayer p){JsonObject r=new JsonObject();JsonArray a=new JsonArray();RpgStore.of(p.getServer()).root.getAsJsonObject("claims").entrySet().stream().limit(128).forEach(e->{JsonObject c=e.getValue().getAsJsonObject().deepCopy();c.addProperty("canManage",c.get("ownerUuid").getAsString().equals(p.getUUID().toString()));a.add(c);});r.add("lands",a);r.addProperty("colonyClaimsUseNativePermissions",true);return r;}
    static JsonObject act(ServerPlayer p,String operation,JsonObject input){
        JsonObject claims=RpgStore.of(p.getServer()).root.getAsJsonObject("claims");String id=ModRequest.text(input,"landId",32);if(!id.matches("[a-z0-9_]{1,32}"))throw new IllegalArgumentException("invalid_land_id");
        if(operation.equals("land_claim")){
            if(claims.has(id))throw new IllegalArgumentException("land_id_exists");long owned=claims.entrySet().stream().filter(e->e.getValue().getAsJsonObject().get("ownerUuid").getAsString().equals(p.getUUID().toString())).count();if(owned>=3||claims.size()>=128)throw new IllegalArgumentException("land_limit_reached");
            BlockPos min=ModRequest.position(input,"min"),max=ModRequest.position(input,"max");long dx=(long)max.getX()-min.getX()+1,dy=(long)max.getY()-min.getY()+1,dz=(long)max.getZ()-min.getZ()+1;
            if(dx<1||dy<1||dz<1||dx>32||dy>48||dz>32||dx*dy*dz>32768||!min.closerThan(p.blockPosition(),64)||!max.closerThan(p.blockPosition(),64)||p.level().dimension().location().toString().equals("maw:trials"))throw new IllegalArgumentException("land_bounds_invalid_or_too_far");
            for(var entry:claims.entrySet()){JsonObject c=entry.getValue().getAsJsonObject();if(!c.get("dimension").getAsString().equals(p.level().dimension().location().toString()))continue;JsonObject a=c.getAsJsonObject("min"),b=c.getAsJsonObject("max");if(min.getX()<=b.get("x").getAsInt()&&max.getX()>=a.get("x").getAsInt()&&min.getY()<=b.get("y").getAsInt()&&max.getY()>=a.get("y").getAsInt()&&min.getZ()<=b.get("z").getAsInt()&&max.getZ()>=a.get("z").getAsInt())throw new IllegalArgumentException("land_overlaps_protection_or_unloaded");}
            // Colony claims and vanilla spawn protection are column based. Bound reads to 3072.
            for(int x=min.getX();x<=max.getX();x++)for(int z=min.getZ();z<=max.getZ();z++)for(int y:new int[]{min.getY(),(min.getY()+max.getY())/2,max.getY()})if(!allowed(p,"place",new BlockPos(x,y,z)))throw new IllegalArgumentException("land_overlaps_protection_or_unloaded");
            JsonObject c=new JsonObject();c.addProperty("id",id);c.addProperty("ownerUuid",p.getUUID().toString());c.addProperty("dimension",p.level().dimension().location().toString());c.add("min",ModRequest.position(min));c.add("max",ModRequest.position(max));c.add("members",new JsonArray());c.addProperty("visitorUse",true);claims.add(id,c);
        }else{
            if(!claims.has(id))throw new IllegalArgumentException("land_not_found");JsonObject c=claims.getAsJsonObject(id);if(!c.get("ownerUuid").getAsString().equals(p.getUUID().toString()))throw new IllegalArgumentException("not_land_owner");
            if(operation.equals("land_release"))claims.remove(id);
            else {String target=ModRequest.text(input,"targetUuid",36);UUID.fromString(target);JsonArray members=c.getAsJsonArray("members");JsonPrimitive value=new JsonPrimitive(target);if(operation.equals("land_trust")){if(p.getServer().getPlayerList().getPlayer(UUID.fromString(target))==null||!PlayerAuthBridge.authenticated(p.getServer().getPlayerList().getPlayer(UUID.fromString(target))))throw new IllegalArgumentException("target_must_be_authenticated_online");if(members.size()>=64)throw new IllegalArgumentException("land_member_limit");if(!members.contains(value))members.add(value);}else if(operation.equals("land_untrust")){members.remove(value);ServerPlayer revoked=p.getServer().getPlayerList().getPlayer(UUID.fromString(target));if(revoked!=null)revoked.closeContainer();}else throw new IllegalArgumentException("unsupported_land_operation");}
        }
        RpgStore.of(p.getServer()).setDirty();JsonObject r=list(p);r.addProperty("ok",true);return r;
    }
}
