package dev.qiandeng.maw;

import com.google.gson.*;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.neoforged.fml.ModList;
import java.lang.reflect.InvocationTargetException;
import java.util.*;
import java.util.function.Supplier;

/** Optional Folkways 5567e84 API binding. Public native methods only; the held
 * bound colony book is the upstream capability. No global colony enumeration,
 * UI packet simulation, NPC impersonation, new currency or forced chunk loads. */
final class FolkwaysAccess {
    private static final String ROOT="io.github.izakyl.folkways.";
    static Class<?> type(String name) {try{return Class.forName(ROOT+name);}catch(ClassNotFoundException e){throw new IllegalStateException("folkways_api_unavailable",e);}}
    static Object call(String owner,Object target,String method,Class<?>[] types,Object...args) {
        try{return type(owner).getMethod(method,types).invoke(target,args);}
        catch(InvocationTargetException e){throw new IllegalStateException("folkways_native_call_failed",e.getCause());}
        catch(ReflectiveOperationException e){throw new IllegalStateException("folkways_api_version_mismatch",e);}
    }
    static Object get(String owner,Object target,String method) {return call(owner,target,method,new Class<?>[0]);}
    private static void available(){if(!ModList.get().isLoaded("folkways"))ModRequest.fail("optional_mod_not_installed:folkways");}
    private static ItemStack book(ServerPlayer p) {
        for(var hand:InteractionHand.values()){var stack=p.getItemInHand(hand);if(type("front.engine.item.ColonyBookItem").isInstance(stack.getItem()))return stack;}
        ModRequest.fail("hold_folkways_colony_book");return ItemStack.EMPTY;
    }
    @SuppressWarnings("unchecked")
    private static Optional<UUID> bound(ItemStack book){return (Optional<UUID>)call("front.engine.item.ColonyBookItem",null,"boundColonyId",new Class<?>[]{ItemStack.class},book);}
    private static Object authority(ServerPlayer p) {
        UUID id=bound(book(p)).orElseThrow(()->new IllegalArgumentException("folkways_book_not_bound"));
        var result=(Optional<?>)call("front.engine.authority.ColonyAuthority",null,"ofHeldBook",new Class<?>[]{ServerPlayer.class,UUID.class},p,id);
        return result.orElseThrow(()->new IllegalArgumentException("folkways_colony_unavailable"));
    }
    static Object colony(ServerPlayer p){return get("front.engine.authority.ColonyAuthority",authority(p),"colony");}
    static String id(Object colony){return get("core.api.colony.Colony",colony,"id").toString();}
    private static JsonObject stateInput(){JsonObject o=new JsonObject();o.addProperty("schemaVersion",1);return o;}
    static JsonObject query(ServerPlayer p,String kind,JsonObject input) {
        available();
        if(FolkwaysWork.READS.contains(kind))return FolkwaysWork.query(p,kind,input);
        ModRequest.fields(input);
        if(kind.equals("folkways_catalog"))return catalog();
        JsonObject out=new JsonObject();out.addProperty("available",true);out.addProperty("providerCommit","5567e84");
        out.addProperty("dimension",p.level().dimension().location().toString());out.addProperty("authority","held_bound_colony_book");
        ItemStack held;
        try{held=book(p);}catch(ModRequest.Invalid missing){out.add("colonyId",JsonNull.INSTANCE);out.addProperty("reason","hold_folkways_colony_book");return out;}
        if(bound(held).isEmpty()){out.add("colonyId",JsonNull.INSTANCE);out.addProperty("reason","book_unbound_use_folkways.found");return out;}
        Object c=colony(p);out.addProperty("colonyId",id(c));
        List<?> residents=(List<?>)get("core.api.colony.Colony",c,"residents");JsonArray people=new JsonArray();
        for(Object r:residents.stream().limit(32).toList()){
            JsonObject row=new JsonObject();row.addProperty("uuid",get("core.api.resident.Resident",r,"id").toString());
            row.addProperty("kind",get("core.api.resident.Resident",r,"kind").toString());people.add(row);
            var entity=p.serverLevel().getEntity((UUID)get("core.api.resident.Resident",r,"id"));
            row.addProperty("loadedInCurrentDimension",entity!=null);
            if(entity!=null){row.add("position",ModRequest.position(entity.blockPosition()));row.addProperty("alive",entity.isAlive());}
        }
        out.add("residents",people);out.addProperty("residentCount",residents.size());out.addProperty("residentsTruncated",residents.size()>32);
        Object front=call("front.api.Fronts",null,"of",new Class<?>[]{type("core.api.colony.Colony")},c);
        List<?> zones=(List<?>)call("front.api.FrontView",front,"zonesIn",new Class<?>[]{ServerLevel.class},p.serverLevel());JsonArray areas=new JsonArray();
        for(Object z:zones.stream().limit(24).toList()){
            JsonObject row=new JsonObject();row.addProperty("id",get("front.api.ZoneView",z,"id").toString());
            row.addProperty("delegation",get("front.api.ZoneView",z,"delegation").toString());
            Set<?> cells=(Set<?>)get("front.api.ZoneView",z,"cells");row.addProperty("cellCount",cells.size());
            if(!cells.isEmpty()){
                BlockPos min=(BlockPos)cells.iterator().next(),max=min;
                for(Object cell:cells){min=BlockPos.min(min,(BlockPos)cell);max=BlockPos.max(max,(BlockPos)cell);}
                row.add("min",ModRequest.position(min));row.add("max",ModRequest.position(max));
            }areas.add(row);
        }
        out.add("zones",areas);out.addProperty("zoneCount",zones.size());out.addProperty("zonesTruncated",zones.size()>24);
        List<?> stores=(List<?>)call("core.api.colony.Colony",c,"storesIn",new Class<?>[]{net.minecraft.resources.ResourceKey.class},p.level().dimension());JsonArray positions=new JsonArray();
        for(Object s:stores.stream().limit(32).toList()){
            try{positions.add(ModRequest.position((BlockPos)call("core.api.terms.WorldPos",s,"block",new Class<?>[]{Level.class},p.level())));}catch(RuntimeException ignored){}
        }
        out.add("stores",positions);out.addProperty("storeCount",stores.size());out.addProperty("storesTruncated",stores.size()>32);return out;
    }
    private static JsonObject catalog() {
        JsonObject out=new JsonObject();JsonArray rows=new JsonArray();List<?> all=(List<?>)call("front.engine.Enrollments",null,"delegations",new Class<?>[0]);
        for(Object d:all.stream().limit(48).toList()){
            JsonObject row=new JsonObject();row.addProperty("id",get("front.api.Delegation",d,"id").toString());
            Object shape=get("front.api.Delegation",d,"shape");String name=shape.getClass().getSimpleName();row.addProperty("shape",name);
            if(name.equals("Volume"))row.addProperty("maxCells",((Number)get("front.api.Shape$Volume",shape,"maxCells")).intValue());
            if(name.equals("Path"))row.addProperty("maxPoints",((Number)get("front.api.Shape$Path",shape,"maxPoints")).intValue());
            row.addProperty("settingsMode","native_defaults");rows.add(row);
        }
        out.add("delegations",rows);out.addProperty("truncated",all.size()>48);out.addProperty("agentZoneMaxCells",4096);
        JsonArray residents=new JsonArray();for(ResourceLocation key:BuiltInRegistries.ENTITY_TYPE.keySet()){
            if(residents.size()<32&&((Optional<?>)call("front.engine.Enrollments",null,"admission",new Class<?>[]{ResourceLocation.class},key)).isPresent())residents.add(key.toString());
        }out.add("residentKinds",residents);
        out.addProperty("agentZoneRadius",32);out.addProperty("customUiAdapted",false);out.addProperty("residentBodyKind","mob_not_player");return out;
    }
    static Supplier<JsonObject> prepare(ServerPlayer p,String kind,JsonObject input) {
        available();ModRequest.active(p);
        if(FolkwaysWork.WRITES.contains(kind))return FolkwaysWork.prepare(p,kind,input);
        if(kind.equals("folkways_found")){
            ModRequest.fields(input);ItemStack stack=book(p);
            if(bound(stack).isPresent())return ()->{JsonObject o=query(p,"folkways_state",stateInput());o.addProperty("alreadyFounded",true);return o;};
            return ()->{call("front.engine.item.ColonyBookItem",null,"bindNewColony",new Class<?>[]{ItemStack.class,ServerLevel.class},stack,p.serverLevel());p.inventoryMenu.broadcastChanges();return query(p,"folkways_state",stateInput());};
        }
        Object c=colony(p);
        if(kind.equals("folkways_member")){
            ModRequest.fields(input,"position","expectedBlockId","joined");BlockPos pos=ModRequest.position(input,"position");
            ModOperationsBridge.visible(p,input,true);if(!RpgProtection.allowed(p,"place",pos))ModRequest.fail("protected_colony_site");
            boolean desired=ModRequest.bool(input,"joined");
            Optional<?> owner=(Optional<?>)call("front.engine.colony.ColonyGround",null,"ofBlock",new Class<?>[]{ServerLevel.class,BlockPos.class},p.serverLevel(),pos);
            if(owner.isPresent()&&!id(owner.get()).equals(id(c)))ModRequest.fail("folkways_site_belongs_to_other_colony");
            boolean before=owner.isPresent();
            return ()->{
                if(before!=desired)call("front.engine.colony.MemberToggle",null,"toggleAt",new Class<?>[]{ServerLevel.class,type("core.api.colony.Colony"),BlockPos.class,ServerPlayer.class},p.serverLevel(),c,pos,p);
                Optional<?> after=(Optional<?>)call("front.engine.colony.ColonyGround",null,"ofBlock",new Class<?>[]{ServerLevel.class,BlockPos.class},p.serverLevel(),pos);
                JsonObject out=query(p,"folkways_state",stateInput());out.addProperty("joined",after.isPresent()&&id(after.get()).equals(id(c)));out.addProperty("applied",out.get("joined").getAsBoolean()==desired);return out;
            };
        }
        if(kind.equals("folkways_zone")){
            ModRequest.fields(input,"delegation","min","max");ResourceLocation delegation=ResourceLocation.parse(ModRequest.text(input,"delegation",256));
            BlockPos a=ModRequest.position(input,"min"),b=ModRequest.position(input,"max"),min=BlockPos.min(a,b),max=BlockPos.max(a,b);
            long volume=((long)max.getX()-min.getX()+1)*((long)max.getY()-min.getY()+1)*((long)max.getZ()-min.getZ()+1);
            if(volume<1||volume>4096||min.distSqr(p.blockPosition())>1024||max.distSqr(p.blockPosition())>1024)ModRequest.fail("folkways_zone_out_of_bounds");
            for(var pos:BlockPos.betweenClosed(min,max)){
                if(!p.level().isLoaded(pos)||!p.level().mayInteract(p,pos)||!RpgProtection.allowed(p,"place",pos)||!RpgProtection.allowed(p,"break",pos))ModRequest.fail("folkways_zone_not_loaded_or_protected");
                var nativeClaim=com.minecolonies.api.colony.IColonyManager.getInstance().getColonyByPosFromWorld(p.level(),pos);
                if(nativeClaim!=null&&!nativeClaim.getPermissions().hasPermission(p,com.minecolonies.api.colony.permissions.Action.ACCESS_HUTS))ModRequest.fail("colony_machine_access_denied");
            }
            Optional<?> shape=(Optional<?>)call("front.engine.colony.ZoneDrafts",null,"volumeOf",new Class<?>[]{ResourceLocation.class},delegation);
            if(shape.isEmpty()||volume>((Number)get("front.api.Shape$Volume",shape.get(),"maxCells")).longValue())ModRequest.fail("folkways_invalid_zone_delegation_or_size");
            Object settings=call("front.engine.colony.ColonySettings",null,"empty",new Class<?>[0]);
            return ()->{
                Optional<?> zone=(Optional<?>)call("front.engine.colony.ZoneDrafts",null,"zone",new Class<?>[]{ServerLevel.class,type("core.api.colony.Colony"),ResourceLocation.class,BlockPos.class,BlockPos.class,type("front.engine.colony.ColonySettings")},p.serverLevel(),c,delegation,min,max,settings);
                JsonObject out=query(p,"folkways_state",stateInput());out.addProperty("applied",zone.isPresent());return out;
            };
        }
        throw new IllegalArgumentException("unsupported_folkways_operation");
    }
}
