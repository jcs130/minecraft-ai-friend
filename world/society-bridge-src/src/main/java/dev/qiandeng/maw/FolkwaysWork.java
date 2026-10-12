package dev.qiandeng.maw;

import com.google.gson.*;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.Tag;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import java.util.*;
import java.util.function.Supplier;
import static dev.qiandeng.maw.FolkwaysAccess.*;

/** Native orders, immigration and Create network diagnostics. This adapter
 * never manufactures goods, NPCs, trains or delivery completion. */
final class FolkwaysWork {
    static final Set<String> READS=Set.of("folkways_orders","folkways_logistics","folkways_rail");
    static final Set<String> WRITES=Set.of("folkways_order","folkways_hire","folkways_logistics_link");
    private static final String COLONY="core.api.colony.Colony", FACING="front.api.Facing";
    private static final String PACKAGE="plugins.dispatch.PackageNetwork", TRANSIT="plugins.rail.domain.TransitNetwork";
    private static Object construct(String name,Class<?> argType,Object value){
        try{return type(name).getConstructor(argType).newInstance(value);}
        catch(ReflectiveOperationException e){throw new IllegalStateException("folkways_api_version_mismatch",e);}
    }
    private static Object view(ServerPlayer p,Object c){return call(COLONY,c,"view",new Class<?>[]{ServerLevel.class},p.serverLevel());}
    private static Object service(Object c,String owner,String name){
        return ((Optional<?>)call(COLONY,c,"service",new Class<?>[]{ResourceLocation.class,Class.class},ResourceLocation.parse(owner),type(name)))
            .orElseThrow(()->new IllegalStateException("folkways_service_unavailable"));
    }
    private static JsonObject attempted(Object attempt){
        JsonObject out=new JsonObject();boolean refused=(Boolean)get("front.api.notice.Attempt",attempt,"refused");out.addProperty("applied",!refused);
        if(refused){Object why=((Optional<?>)get("front.api.notice.Attempt",attempt,"refusal")).orElseThrow();out.addProperty("nativeReason",get("front.api.notice.Notice",why,"key").toString());}
        return out;
    }
    private static JsonObject address(ServerPlayer p,Object where){
        JsonObject out=new JsonObject();Optional<?> level=(Optional<?>)call("core.api.terms.WorldPos",where,"level",new Class<?>[]{MinecraftServer.class},p.getServer());
        if(level.isEmpty()){out.addProperty("resolved",false);return out;}
        ServerLevel l=(ServerLevel)level.get();out.addProperty("dimension",l.dimension().location().toString());
        BlockPos pos=(BlockPos)call("core.api.terms.WorldPos",where,"block",new Class<?>[]{Level.class},l);
        out.add("position",ModRequest.position(pos));out.addProperty("resolved",true);out.addProperty("loaded",l.isLoaded(pos));return out;
    }
    static JsonObject query(ServerPlayer p,String kind,JsonObject input){
        Object c=colony(p);
        if(kind.equals("folkways_logistics")){ModRequest.fields(input,"position","aimOffset");return logistics(p,c,input);}
        ModRequest.fields(input);
        return kind.equals("folkways_orders")?orders(p,c):rail(p,c);
    }
    private static JsonObject orders(ServerPlayer p,Object c){
        CompoundTag kept=(CompoundTag)call(COLONY,c,"kept",new Class<?>[]{ResourceLocation.class},ResourceLocation.parse("folkways:orders"));
        var all=kept.getList("orders",Tag.TAG_COMPOUND);JsonArray rows=new JsonArray();
        for(int i=0;i<Math.min(all.size(),48);i++){
            CompoundTag order=all.getCompound(i);JsonObject row=new JsonObject();
            Object reader=call("core.api.persist.Reader",null,"of",new Class<?>[]{CompoundTag.class},order.getCompound("into"));
            Optional<?> where=(Optional<?>)call("core.api.terms.WorldPos",null,"load",new Class<?>[]{type("core.api.persist.Reader")},reader);
            where.ifPresent(w->row.add("destination",address(p,w)));
            reader=call("core.api.persist.Reader",null,"of",new Class<?>[]{CompoundTag.class},order.getCompound("what"));
            Optional<?> spec=(Optional<?>)call("core.api.terms.ItemSpec",null,"load",new Class<?>[]{type("core.api.persist.Reader")},reader);
            spec.ifPresent(s->row.addProperty("item",get("core.api.terms.ItemSpec",s,"describe").toString()));
            row.addProperty("low",order.getInt("low"));row.addProperty("count",order.getInt("count"));row.addProperty("standing",order.getBoolean("standing"));row.addProperty("rank",order.getInt("rank"));
            if(order.contains("remaining",Tag.TAG_LONG))row.addProperty("remaining",order.getLong("remaining"));else row.add("remaining",JsonNull.INSTANCE);
            rows.add(row);
        }
        JsonObject out=new JsonObject();out.addProperty("colonyId",id(c));out.add("orders",rows);out.addProperty("orderCount",all.size());out.addProperty("truncated",all.size()>48);return out;
    }
    private static Object network(ServerPlayer p,BlockPos pos){
        Object n=call("plugins.dispatch.PackageNetworks",null,"get",new Class<?>[0]);
        Optional<?> id=(Optional<?>)call(PACKAGE,n,"networkAt",new Class<?>[]{ServerLevel.class,BlockPos.class},p.serverLevel(),pos);
        if(id.isEmpty())ModRequest.fail("folkways_no_package_network");
        if(!(Boolean)call(PACKAGE,n,"mayAdministrate",new Class<?>[]{MinecraftServer.class,UUID.class,ServerPlayer.class},p.getServer(),id.get(),p))ModRequest.fail("folkways_network_not_yours");return n;
    }
    private static UUID networkId(ServerPlayer p,Object n,BlockPos pos){return (UUID)((Optional<?>)call(PACKAGE,n,"networkAt",new Class<?>[]{ServerLevel.class,BlockPos.class},p.serverLevel(),pos)).orElseThrow();}
    private static JsonObject logistics(ServerPlayer p,Object c,JsonObject input){
        ModOperationsBridge.visible(p,input,false);BlockPos pos=ModRequest.position(input,"position");Object n=network(p,pos);UUID net=networkId(p,n,pos);
        JsonObject out=new JsonObject();out.addProperty("colonyId",id(c));out.addProperty("networkId",net.toString());out.addProperty("dimension",p.level().dimension().location().toString());
        Object dispatch=service(c,"folkways:dispatch","plugins.dispatch.DispatchPresence");out.addProperty("linked",(Boolean)call("plugins.dispatch.DispatchPresence",dispatch,"holds",new Class<?>[]{UUID.class},net));
        Optional<?> flaw=(Optional<?>)call(PACKAGE,n,"flawOf",new Class<?>[]{ServerLevel.class,UUID.class},p.serverLevel(),net);
        if(flaw.isPresent()){Object f=flaw.get();out.addProperty("flaw",get(PACKAGE+"$Flaw",f,"kind").toString().toLowerCase(Locale.ROOT));out.add("flawPosition",ModRequest.position((BlockPos)get(PACKAGE+"$Flaw",f,"at")));}else out.add("flaw",JsonNull.INSTANCE);
        List<?> ports=(List<?>)call(PACKAGE,n,"portsOf",new Class<?>[]{ServerLevel.class,UUID.class},p.serverLevel(),net);JsonArray places=new JsonArray();
        for(Object port:ports.stream().limit(24).toList())places.add(ModRequest.position((BlockPos)port));out.add("ports",places);out.addProperty("portsTruncated",ports.size()>24);
        List<?> supplies=(List<?>)call(PACKAGE,n,"summaryOf",new Class<?>[]{MinecraftServer.class,UUID.class},p.getServer(),net);JsonArray goods=new JsonArray();
        for(Object supply:supplies.stream().limit(24).toList()){JsonObject row=new JsonObject();ItemStack item=(ItemStack)get(PACKAGE+"$Supply",supply,"item");row.addProperty("itemId",BuiltInRegistries.ITEM.getKey(item.getItem()).toString());row.addProperty("count",((Number)get(PACKAGE+"$Supply",supply,"count")).longValue());goods.add(row);}out.add("supplies",goods);out.addProperty("suppliesTruncated",supplies.size()>24);
        List<?> desks=(List<?>)call(PACKAGE,n,"desksOf",new Class<?>[]{ServerLevel.class,UUID.class},p.serverLevel(),net);JsonArray counters=new JsonArray();
        for(Object desk:desks.stream().limit(24).toList()){JsonObject row=ModRequest.position((BlockPos)desk);List<?> seats=(List<?>)call(PACKAGE,n,"keeperSeats",new Class<?>[]{ServerLevel.class,BlockPos.class},p.serverLevel(),desk);int occupied=0;for(Object seat:seats)if(((Optional<?>)call(PACKAGE,n,"sitting",new Class<?>[]{ServerLevel.class,BlockPos.class},p.serverLevel(),seat)).isPresent())occupied++;row.addProperty("keeperSeats",seats.size());row.addProperty("occupiedSeats",occupied);counters.add(row);}out.add("desks",counters);return out;
    }
    private static JsonObject rail(ServerPlayer p,Object c){
        Object n=call("plugins.rail.domain.TransitNetworks",null,"get",new Class<?>[0]);Object roster=service(c,"folkways:rail","plugins.rail.domain.RailPresence");
        List<?> all=(List<?>)get("plugins.rail.domain.RailPresence",roster,"taken");JsonArray trains=new JsonArray();
        for(Object train:all.stream().limit(16).toList()){
            UUID uuid=(UUID)train;JsonObject row=new JsonObject();row.addProperty("uuid",uuid.toString());
            row.addProperty("exists",(Boolean)call(TRANSIT,n,"exists",new Class<?>[]{MinecraftServer.class,UUID.class},p.getServer(),uuid));
            row.addProperty("serviceable",(Boolean)call(TRANSIT,n,"isServiceable",new Class<?>[]{MinecraftServer.class,UUID.class},p.getServer(),uuid));
            Optional<?> fault=(Optional<?>)call(TRANSIT,n,"fault",new Class<?>[]{MinecraftServer.class,UUID.class},p.getServer(),uuid);
            if(fault.isPresent()){row.addProperty("fault",get("plugins.rail.domain.TimetableFault",fault.get(),"key").toString());row.addProperty("faultStop",get("plugins.rail.domain.TimetableFault",fault.get(),"stop").toString());}else row.add("fault",JsonNull.INSTANCE);
            Optional<?> station=(Optional<?>)call(TRANSIT,n,"currentStation",new Class<?>[]{MinecraftServer.class,UUID.class},p.getServer(),uuid);if(station.isPresent())row.addProperty("currentStation",station.get().toString());else row.add("currentStation",JsonNull.INSTANCE);
            List<?> stops=(List<?>)call(TRANSIT,n,"scheduledStations",new Class<?>[]{MinecraftServer.class,UUID.class},p.getServer(),uuid);JsonArray stations=new JsonArray();for(Object s:stops.stream().limit(24).toList())stations.add(s.toString());row.add("stations",stations);row.addProperty("stationsTruncated",stops.size()>24);
            row.addProperty("forwardConductor",(Boolean)call(TRANSIT,n,"hasConductor",new Class<?>[]{MinecraftServer.class,UUID.class,boolean.class},p.getServer(),uuid,true));
            List<?> seats=(List<?>)call(TRANSIT,n,"passengerSeats",new Class<?>[]{MinecraftServer.class,UUID.class},p.getServer(),uuid);int occupied=0;for(Object s:seats)if(((Optional<?>)call(TRANSIT,n,"occupant",new Class<?>[]{MinecraftServer.class,type("plugins.rail.domain.SeatRef")},p.getServer(),s)).isPresent())occupied++;row.addProperty("passengerSeats",seats.size());row.addProperty("occupiedSeats",occupied);trains.add(row);
        }
        JsonObject out=new JsonObject();out.addProperty("colonyId",id(c));out.addProperty("available",(Boolean)get(TRANSIT,n,"isAvailable"));out.add("trains",trains);out.addProperty("trainCount",all.size());out.addProperty("truncated",all.size()>16);out.addProperty("handover","offhand_colony_book_use_schedule_on_train_seat");return out;
    }
    static Supplier<JsonObject> prepare(ServerPlayer p,String kind,JsonObject input){
        Object c=colony(p);
        if(kind.equals("folkways_hire")){
            ModRequest.fields(input,"residentKind");ResourceLocation resident=ResourceLocation.parse(ModRequest.text(input,"residentKind",256));
            if(((Optional<?>)call("front.engine.Enrollments",null,"admission",new Class<?>[]{ResourceLocation.class},resident)).isEmpty())ModRequest.fail("folkways_unknown_resident_kind");
            return ()->attempted(call("front.engine.colony.Endorsements",null,"called",new Class<?>[]{ServerLevel.class,type(COLONY),Player.class,ResourceLocation.class},p.serverLevel(),c,p,resident));
        }
        ModOperationsBridge.visible(p,input,true);BlockPos pos=ModRequest.position(input,"position");if(!RpgProtection.allowed(p,"place",pos))ModRequest.fail("protected_colony_site");
        if(kind.equals("folkways_logistics_link")){
            ModRequest.fields(input,"position","expectedBlockId","joined","aimOffset");Object n=network(p,pos);UUID net=networkId(p,n,pos);Object dispatch=service(c,"folkways:dispatch","plugins.dispatch.DispatchPresence");boolean desired=ModRequest.bool(input,"joined");
            return ()->{JsonObject out=new JsonObject();boolean before=(Boolean)call("plugins.dispatch.DispatchPresence",dispatch,"holds",new Class<?>[]{UUID.class},net);
                if(before!=desired){Optional<?> answer=(Optional<?>)call(FACING,dispatch,"pointedAt",new Class<?>[]{BlockPos.class,type("core.api.colony.ColonyView"),ServerPlayer.class},pos,view(p,c),p);if(answer.isEmpty())throw new IllegalStateException("folkways_network_handover_unavailable");out=attempted(answer.get());}
                boolean after=(Boolean)call("plugins.dispatch.DispatchPresence",dispatch,"holds",new Class<?>[]{UUID.class},net);out.addProperty("linked",after);out.addProperty("applied",after==desired);out.addProperty("networkId",net.toString());return out;};
        }
        ModRequest.fields(input,"position","expectedBlockId","mode","itemId","low","count","rank","aimOffset");
        Optional<?> owner=(Optional<?>)call("front.engine.colony.ColonyGround",null,"ofBlock",new Class<?>[]{ServerLevel.class,BlockPos.class},p.serverLevel(),pos);
        if(owner.isEmpty()||!id(owner.get()).equals(id(c)))ModRequest.fail("folkways_order_destination_not_member");
        String mode=ModRequest.text(input,"mode",16);if(!Set.of("deliver","maintain","withdraw").contains(mode))ModRequest.fail("folkways_invalid_order_mode");
        ResourceLocation item=ResourceLocation.parse(ModRequest.text(input,"itemId",256));if(!BuiltInRegistries.ITEM.containsKey(item)||item.equals(ResourceLocation.withDefaultNamespace("air")))ModRequest.fail("folkways_unknown_order_item");
        int low=ModRequest.integer(input,"low",1,9999),count=ModRequest.integer(input,"count",1,9999),rank=ModRequest.integer(input,"rank",-2,2);if(low>count)ModRequest.fail("folkways_order_low_exceeds_count");
        Object front=call("front.engine.colony.ColonyFront",null,"of",new Class<?>[]{type(COLONY)},c);ResourceLocation orders=ResourceLocation.parse("folkways:orders");Object facing=((Optional<?>)call(FACING,null,"of",new Class<?>[]{type(COLONY),ResourceLocation.class},c,orders)).orElseThrow();
        return ()->{
            if(!mode.equals("withdraw")){
                Object filter=call("core.api.terms.ItemFilter",null,"item",new Class<?>[]{ResourceLocation.class},item);Object value=construct("front.engine.colony.ColonySettings$Value$Items",List.class,List.of(filter));
                set(front,orders,"item",value);
                for(var e:Map.of("low",low,"count",count,"rank",rank).entrySet())set(front,orders,e.getKey(),construct("front.engine.colony.ColonySettings$Value$Count",int.class,e.getValue()));
            }
            Object attempt=call(FACING,facing,"act",new Class<?>[]{ResourceLocation.class,String.class,Optional.class,type("core.api.colony.ColonyView")},orders,mode.equals("withdraw")?"withdraw:"+item:mode,Optional.of(pos),view(p,c));JsonObject out=attempted(attempt);out.add("orders",orders(p,c));return out;
        };
    }
    private static void set(Object front,ResourceLocation scope,String key,Object value){
        call("front.engine.colony.ColonyFront",front,"setSetting",new Class<?>[]{ResourceLocation.class,String.class,type("front.engine.colony.ColonySettings$Value")},scope,key,value);
        Object settings=call("front.engine.colony.ColonyFront",front,"settings",new Class<?>[]{ResourceLocation.class},scope);
        if(!((Optional<?>)call("front.engine.colony.ColonySettings",settings,"valueOf",new Class<?>[]{String.class},key)).filter(value::equals).isPresent())throw new IllegalStateException("folkways_setting_not_applied");
    }
}
