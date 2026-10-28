package dev.qiandeng.maw.taunative;

import com.google.gson.*;
import com.mojang.serialization.JsonOps;
import dev.qiandeng.maw.PlayerAuthBridge;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.chat.ComponentSerialization;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.RegistryOps;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.inventory.DataSlot;
import net.minecraft.world.item.ItemStack;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModList;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import net.neoforged.neoforge.network.PacketDistributor;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;

import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;

/** An optional native data plane on the ordinary authenticated game connection. */
@Mod(value="maw_tau_native",dist=Dist.DEDICATED_SERVER)
public final class NativeBridge {
    private static final String EPOCH=UUID.randomUUID().toString();
    private static final int QUERY_BYTES=4096,ACTION_BYTES=32768,STATE_BYTES=65536,ITEM_BYTES=4096;
    private static final Map<UUID,Long> LAST_READ=new HashMap<>();
    private static final Map<UUID,String> SUBSCRIPTIONS=new HashMap<>();
    private static final Map<UUID,NativePolicy.Receipts> LEDGERS=new HashMap<>();
    private static final Map<UUID,int[]> ACTION_RATES=new HashMap<>();
    private static NativePolicy policy;
    private static Field dataSlots;
    private record Query(String json) implements CustomPacketPayload {
        static final Type<Query> TYPE=new Type<>(ResourceLocation.parse("maw_agent:world_query"));
        static final StreamCodec<RegistryFriendlyByteBuf,Query> CODEC=StreamCodec.of((b,p)->write(b,p.json,QUERY_BYTES),b->new Query(read(b,QUERY_BYTES)));
        public Type<Query> type(){return TYPE;}
    }
    private record WorldState(String json) implements CustomPacketPayload {
        static final Type<WorldState> TYPE=new Type<>(ResourceLocation.parse("maw_agent:world_state"));
        static final StreamCodec<RegistryFriendlyByteBuf,WorldState> CODEC=StreamCodec.of((b,p)->write(b,p.json,STATE_BYTES),b->new WorldState(read(b,STATE_BYTES)));
        public Type<WorldState> type(){return TYPE;}
    }
    private record MenuAction(String json) implements CustomPacketPayload {
        static final Type<MenuAction> TYPE=new Type<>(ResourceLocation.parse("maw_agent:menu_action"));
        static final StreamCodec<RegistryFriendlyByteBuf,MenuAction> CODEC=StreamCodec.of((b,p)->write(b,p.json,ACTION_BYTES),b->new MenuAction(read(b,ACTION_BYTES)));
        public Type<MenuAction> type(){return TYPE;}
    }
    private record MenuState(String json) implements CustomPacketPayload {
        static final Type<MenuState> TYPE=new Type<>(ResourceLocation.parse("maw_agent:menu_state"));
        static final StreamCodec<RegistryFriendlyByteBuf,MenuState> CODEC=StreamCodec.of((b,p)->write(b,p.json,STATE_BYTES),b->new MenuState(read(b,STATE_BYTES)));
        public Type<MenuState> type(){return TYPE;}
    }
    public NativeBridge(IEventBus bus) {
        try(var in=NativeBridge.class.getResourceAsStream("/native-operations.json")){
            if(in==null)throw new IllegalStateException("Missing native operation contract");
            policy=new NativePolicy(JsonParser.parseString(new String(in.readAllBytes(),StandardCharsets.UTF_8)).getAsJsonObject());
            if(policy.limit("queryBytes")!=QUERY_BYTES||policy.limit("actionBytes")!=ACTION_BYTES||policy.limit("stateBytes")!=STATE_BYTES||policy.limit("itemSnbtBytes")!=ITEM_BYTES)
                throw new IllegalStateException("Native codec budgets differ from operation contract");
            try{dataSlots=AbstractContainerMenu.class.getDeclaredField("dataSlots");dataSlots.setAccessible(true);}catch(ReflectiveOperationException|RuntimeException ignored){dataSlots=null;}
        }catch(java.io.IOException error){throw new IllegalStateException(error);}
        bus.addListener((RegisterPayloadHandlersEvent e)->{
            var r=e.registrar("1").optional();
            r.playToClient(WorldState.TYPE,WorldState.CODEC,(p,c)->{});
            r.playToClient(MenuState.TYPE,MenuState.CODEC,(p,c)->{});
            r.playToServer(Query.TYPE,Query.CODEC,(p,c)->{if(c.player() instanceof ServerPlayer player)c.enqueueWork(()->query(player,p.json));});
            r.playToServer(MenuAction.TYPE,MenuAction.CODEC,(p,c)->{if(c.player() instanceof ServerPlayer player)c.enqueueWork(()->click(player,p.json));});
        });
        NeoForge.EVENT_BUS.addListener((PlayerEvent.PlayerLoggedOutEvent e)->{LAST_READ.remove(e.getEntity().getUUID());SUBSCRIPTIONS.remove(e.getEntity().getUUID());ACTION_RATES.remove(e.getEntity().getUUID());});
        NeoForge.EVENT_BUS.addListener((ServerTickEvent.Post e)->{
            if(e.getServer().getTickCount()%10!=0)return;
            LEDGERS.entrySet().removeIf(entry->entry.getValue().empty(System.currentTimeMillis()));
            for(var p:e.getServer().getPlayerList().getPlayers())if(SUBSCRIPTIONS.containsKey(p.getUUID())&&PlayerAuthBridge.authenticated(p))publish(p);
        });
    }
    private static String read(RegistryFriendlyByteBuf b,int max){
        if(b.readableBytes()>max)throw new IllegalArgumentException("native_payload_budget");
        byte[] raw=new byte[b.readableBytes()];b.readBytes(raw);
        try{return StandardCharsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(raw)).toString();}
        catch(java.nio.charset.CharacterCodingException error){throw new IllegalArgumentException("native_payload_utf8");}
    }
    private static void write(RegistryFriendlyByteBuf b,String json,int max){
        byte[] bytes=json.getBytes(StandardCharsets.UTF_8);if(bytes.length>max)throw new IllegalArgumentException("native_payload_budget");b.writeBytes(bytes);
    }
    private static JsonObject base(ServerPlayer p,String kind,String requestId){
        JsonObject out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("kind",kind);
        out.addProperty("playerUuid",p.getUUID().toString());out.addProperty("bodyId",p.getUUID().toString());
        out.addProperty("bodyKind","connected_player");out.addProperty("serverEpoch",EPOCH);
        if(requestId!=null)out.addProperty("requestId",requestId);
        out.addProperty("capturedAt",Instant.now().toString());out.addProperty("capturedTick",p.getServer().getTickCount());
        out.addProperty("coordinateSystem","minecraft_absolute_world_blocks");out.addProperty("dimension",p.level().dimension().location().toString());
        return out;
    }
    private static JsonObject position(ServerPlayer p){JsonObject a=new JsonObject();a.addProperty("x",p.getX());a.addProperty("y",p.getY());a.addProperty("z",p.getZ());return a;}
    private static String snbt(ServerPlayer p,ItemStack stack){return stack.isEmpty()?"":stack.saveOptional(p.registryAccess()).toString();}
    private static JsonObject item(ServerPlayer p,ItemStack stack){
        if(stack.isEmpty())return null;
        JsonObject a=new JsonObject();String id=BuiltInRegistries.ITEM.getKey(stack.getItem()).toString();
        a.addProperty("id",id);a.addProperty("count",stack.getCount());String name=stack.getHoverName().getString();a.addProperty("displayName",name.length()>256?name.substring(0,256):name);a.addProperty("displayNameTruncated",name.length()>256);
        a.addProperty("descriptionId",stack.getDescriptionId());a.addProperty("source","server_item_stack");
        a.addProperty("maxStackSize",stack.getMaxStackSize());a.addProperty("damage",stack.getDamageValue());a.addProperty("maxDamage",stack.getMaxDamage());
        a.add("displayNameComponent",ComponentSerialization.CODEC.encodeStart(RegistryOps.create(JsonOps.INSTANCE,p.registryAccess()),stack.getHoverName()).getOrThrow());
        if(a.get("displayNameComponent").toString().getBytes(StandardCharsets.UTF_8).length>2048){a.add("displayNameComponent",JsonNull.INSTANCE);a.addProperty("displayNameComponentUnavailableReason","display_component_budget");}
        String full=snbt(p,stack);int bytes=full.getBytes(StandardCharsets.UTF_8).length;
        a.addProperty("componentFingerprint",NativePolicy.sha(full));a.addProperty("componentBytes",bytes);
        a.addProperty("componentsComplete",bytes<=ITEM_BYTES);
        if(bytes<=ITEM_BYTES)a.addProperty("snbt",full);
        else {a.add("snbt",JsonNull.INSTANCE);a.addProperty("partialReason","item_component_budget");}
        var food=stack.get(DataComponents.FOOD);
        if(food==null)a.add("food",JsonNull.INSTANCE);
        else {JsonObject f=new JsonObject();f.addProperty("nutrition",food.nutrition());f.addProperty("saturation",food.saturation());f.addProperty("canAlwaysEat",food.canAlwaysEat());a.add("food",f);}
        return a;
    }
    private static JsonObject menu(ServerPlayer p){
        var m=p.containerMenu;JsonObject out=base(p,"menu_state",null);
        out.addProperty("windowId",m.containerId);out.addProperty("stateId",m.getStateId());
        out.addProperty("selectedHotbarSlot",p.getInventory().selected);
        String type=m.containerId==0?"minecraft:inventory":BuiltInRegistries.MENU.getKey(m.getType()).toString();out.addProperty("menuType",type);
        out.addProperty("title",m.containerId==0?"Inventory":type);out.addProperty("titleSource","menu_type_not_invented_translation");
        JsonArray slots=new JsonArray(),layout=new JsonArray(),inventory=new JsonArray();
        for(int i=0;i<Math.min(256,m.slots.size());i++){
            var s=m.getSlot(i);slots.add(item(p,s.getItem()));JsonObject row=new JsonObject();row.addProperty("slot",i);
            row.addProperty("x",s.x);row.addProperty("y",s.y);row.addProperty("owner",s.container==p.getInventory()?"player_inventory":"container");
            row.addProperty("inventoryIndex",s.getContainerSlot());row.addProperty("mayPickup",s.mayPickup(p));layout.add(row);
        }
        for(var s:p.inventoryMenu.slots)inventory.add(item(p,s.getItem()));
        out.add("slots",slots);out.add("slotLayout",layout);out.add("inventory",inventory);out.add("carried",item(p,m.getCarried()));
        JsonObject self=new JsonObject();self.addProperty("playerUuid",p.getUUID().toString());self.add("position",position(p));
        self.addProperty("health",p.getHealth());self.addProperty("maxHealth",p.getMaxHealth());self.addProperty("food",p.getFoodData().getFoodLevel());
        self.addProperty("saturation",p.getFoodData().getSaturationLevel());self.addProperty("level",p.experienceLevel);
        self.addProperty("status",p.isDeadOrDying()?"dead":"alive");self.add("mana",JsonNull.INSTANCE);self.addProperty("manaUnavailableReason","mod_mana_provider_not_adapted");
        JsonObject equipment=new JsonObject();for(var slot:EquipmentSlot.values())equipment.add(slot.getName(),item(p,p.getItemBySlot(slot)));self.add("equipment",equipment);out.add("self",self);
        if(dataSlots==null){out.add("dataValues",JsonNull.INSTANCE);out.addProperty("dataValuesError","native_menu_data_unavailable");}
        else try{
            var list=(List<?>)dataSlots.get(m);if(list.size()>64)throw new IllegalStateException("budget");JsonArray values=new JsonArray();
            for(var value:list)values.add(((DataSlot)value).get());out.add("dataValues",values);
        }catch(ReflectiveOperationException|RuntimeException failure){out.add("dataValues",JsonNull.INSTANCE);out.addProperty("dataValuesError","native_menu_data_unavailable");}
        out.addProperty("complete",true);out.addProperty("readOnly",true);out.addProperty("source","native_menu_and_original_item_stacks");
        out.addProperty("requestedSlotCount",m.slots.size());out.addProperty("returnedSlotCount",slots.size());out.addProperty("remainingSlotCount",m.slots.size()-slots.size());
        if(m.slots.size()>256){out.addProperty("complete",false);out.addProperty("partialReason","menu_slot_budget");}
        if(out.get("carried").isJsonObject()&&!out.getAsJsonObject("carried").get("componentsComplete").getAsBoolean()){out.addProperty("complete",false);out.addProperty("partialReason","cursor_component_budget");}
        // A large stack remains explicitly incomplete, never a forged empty item.
        for(String key:List.of("slots","inventory"))for(var row:out.getAsJsonArray(key))if(row.isJsonObject()&&!row.getAsJsonObject().get("componentsComplete").getAsBoolean())out.addProperty("complete",false);
        if(out.toString().getBytes(StandardCharsets.UTF_8).length>55000){
            out.addProperty("complete",false);out.addProperty("partialReason","menu_component_byte_budget");
            for(String key:List.of("slots","inventory"))for(var row:out.getAsJsonArray(key))if(row.isJsonObject()){
                var i=row.getAsJsonObject();i.add("snbt",JsonNull.INSTANCE);i.addProperty("componentsComplete",false);i.addProperty("partialReason","menu_component_byte_budget");
            }
        }
        return out;
    }
    private static void sendWorld(ServerPlayer p,JsonObject out){if(p.connection!=null&&p.connection.hasChannel(WorldState.TYPE))PacketDistributor.sendToPlayer(p,new WorldState(NativePolicy.bounded(out,STATE_BYTES).toString()));}
    private static void sendMenu(ServerPlayer p,JsonObject out){if(p.connection!=null&&p.connection.hasChannel(MenuState.TYPE))PacketDistributor.sendToPlayer(p,new MenuState(NativePolicy.bounded(out,STATE_BYTES).toString()));}
    private static void publish(ServerPlayer p){
        JsonObject out=menu(p),semantic=out.deepCopy();for(String key:List.of("capturedAt","capturedTick","self"))semantic.remove(key);
        String signature=NativePolicy.sha(semantic.toString());if(!signature.equals(SUBSCRIPTIONS.put(p.getUUID(),signature)))sendMenu(p,out);
    }
    private static boolean recipeAvailable(){return ModList.get().isLoaded("create")&&ModList.get().isLoaded("farmersdelight");}
    private static void error(JsonObject out,String code,String status){
        out.addProperty("ok",false);out.addProperty("complete",false);out.addProperty("code",code);out.addProperty("status",status);out.addProperty("retryAutomatically",false);
        out.addProperty("retryable",false);out.addProperty("outcomeKnown",!status.equals("unknown"));out.addProperty("outcomeUnknown",status.equals("unknown"));
    }
    private static boolean validRequestId(String id){return id!=null&&id.matches("[A-Za-z0-9:_-]{1,64}");}
    private static void diagnostic(JsonObject out,NativePolicy.Problem problem,JsonObject op){
        error(out,"invalid_parameters","error");JsonObject d=new JsonObject();d.addProperty("field",problem.field());d.addProperty("expected",problem.expected());d.addProperty("issue",problem.issue());
        out.add("diagnostic",d);out.add("example",op.get("example").deepCopy());
    }
    private static void query(ServerPlayer p,String raw){
        JsonObject out=base(p,"world_receipt",null);out.addProperty("readOnly",true);
        try{
            JsonObject input=JsonParser.parseString(raw).getAsJsonObject();
            String id=input.has("requestId")?input.get("requestId").getAsString():null;
            if(!validRequestId(id)){error(out,"invalid_request_id","error");sendWorld(p,out);return;}out.addProperty("requestId",id);
            if(!input.has("schemaVersion")||!input.get("schemaVersion").isJsonPrimitive()||!input.get("schemaVersion").getAsJsonPrimitive().isNumber()||input.get("schemaVersion").getAsDouble()!=1){error(out,"unsupported_schema_version","error");sendWorld(p,out);return;}
            if(!PlayerAuthBridge.authenticated(p)){error(out,"authentication_required","blocked");sendWorld(p,out);return;}
            if(input.has("playerUuid")&&!p.getUUID().toString().equalsIgnoreCase(input.get("playerUuid").getAsString())){error(out,"player_identity_mismatch","blocked");sendWorld(p,out);return;}
            String kind=input.has("kind")?input.get("kind").getAsString():"";out.addProperty("query",kind);
            JsonObject op=policy.query(kind);if(op==null){error(out,"unsupported_native_query","blocked");sendWorld(p,out);return;}
            JsonObject args=input.deepCopy();for(String key:List.of("kind","requestId","schemaVersion","playerUuid"))args.remove(key);
            var problem=NativePolicy.validate(args,op.getAsJsonObject("parameters"),"args");
            if(problem!=null){diagnostic(out,problem,op);sendWorld(p,out);return;}
            long now=System.nanoTime()/1000000;Long previous=LAST_READ.get(p.getUUID());
            if(previous!=null&&now-previous<policy.limit("queryIntervalMs")){error(out,"native_read_rate_limited","blocked");out.addProperty("retryable",true);out.addProperty("retryAfterMs",policy.limit("queryIntervalMs")-(now-previous));sendWorld(p,out);return;}
            LAST_READ.put(p.getUUID(),now);
            SUBSCRIPTIONS.putIfAbsent(p.getUUID(),"");
            out.addProperty("ok",true);out.addProperty("status","ok");out.addProperty("complete",true);out.addProperty("outcomeKnown",true);out.addProperty("retryAutomatically",false);
            switch(kind){
                case "capabilities" -> {
                    out.addProperty("bridgeProtocol",1);out.addProperty("bodySnapshot",true);out.addProperty("bodyObserve",false);out.addProperty("remoteBindingsAdvertised",true);
                    out.addProperty("nativeIdentity",true);out.addProperty("permission","own_connection_normal_player_and_native_mod_permissions");
                    out.addProperty("actionLedger","server_epoch_bounded_cache");out.addProperty("allGameplayVerified",false);out.addProperty("allModsVerified",false);
                    JsonObject contract=policy.contract();JsonArray operations=new JsonArray(),names=new JsonArray();
                    for(var row:contract.getAsJsonArray("operations")){
                        var value=row.getAsJsonObject();if(value.get("id").getAsString().equals("native.recipes")&&!recipeAvailable())continue;
                        operations.add(value);names.add(value.get("id"));
                    }out.add("operations",operations);out.add("nativeOperations",names);out.add("limits",contract.get("limits"));
                }
                case "body_snapshot", "menu" -> {
                    JsonObject m=menu(p);out.add("menu",m);out.add("self",m.get("self").deepCopy());out.add("position",position(p));
                    out.addProperty("status",p.isDeadOrDying()?"dead":m.get("complete").getAsBoolean()?"ok":"partial");out.addProperty("complete",m.get("complete").getAsBoolean());
                    out.add("currentAction",JsonNull.INSTANCE);out.addProperty("currentActionUnavailableReason","controller_state_owned_by_agent_runtime");publish(p);
                }
                case "item" -> {
                    int slot=args.get("slot").getAsInt();out.addProperty("slot",slot);out.addProperty("slotSpace","player_inventory_menu");out.add("item",item(p,p.inventoryMenu.getSlot(slot).getItem()));
                }
                case "recipes" -> {
                    if(!recipeAvailable()){error(out,"native_recipe_provider_unavailable","blocked");break;}
                    PlayerRecipeCatalog.query(p,args,out);boolean partial=out.get("truncated").getAsBoolean();
                    out.addProperty("status",partial?"partial":"ok");out.addProperty("complete",!partial);if(partial)out.addProperty("partialReason","recipe_page_or_byte_budget");
                    out.addProperty("returnedCount",out.getAsJsonArray("recipes").size());out.addProperty("remainingCount",Math.max(0,out.get("matchedCount").getAsInt()-out.get("offset").getAsInt()-out.getAsJsonArray("recipes").size()));
                    boolean definitionsComplete=true;for(var recipe:out.getAsJsonArray("recipes"))if(!recipe.getAsJsonObject().get("definitionAvailable").getAsBoolean())definitionsComplete=false;
                    out.addProperty("definitionsComplete",definitionsComplete);
                    if(!definitionsComplete){out.addProperty("complete",false);out.addProperty("status","partial");out.addProperty("partialReason",partial?"recipe_page_and_definition_limits":"recipe_semantics_not_fully_available");}
                    if(out.has("filterCoverageComplete")&&!out.get("filterCoverageComplete").getAsBoolean()){
                        out.addProperty("complete",false);out.addProperty("status","partial");out.addProperty("partialReason","recipe_filter_semantics_incomplete");
                    }
                }
                case "action_status" -> {
                    String action=args.get("actionRequestId").getAsString();out.addProperty("actionRequestId",action);
                    var ledger=LEDGERS.get(p.getUUID());var entry=ledger==null?null:ledger.get(action,System.currentTimeMillis());
                    if(args.has("originServerEpoch")&&!EPOCH.equals(args.get("originServerEpoch").getAsString())||entry==null){error(out,"receipt_unknown_or_expired","unknown");out.add("receipt",JsonNull.INSTANCE);}
                    else {out.add("receipt",entry.receipt().deepCopy());out.addProperty("status",entry.receipt().get("status").getAsString());}
                }
            }
        }catch(RuntimeException failure){error(out,"native_read_failed","error");out.addProperty("reason",failure.getClass().getSimpleName());}
        sendWorld(p,out);
    }
    private static void click(ServerPlayer p,String raw){
        JsonObject out=base(p,"action_receipt",null);out.addProperty("action","click");out.addProperty("changed",false);out.addProperty("readOnly",false);
        String id=null,fingerprint=null;NativePolicy.Receipts ledger=null;boolean began=false;
        try{
            JsonObject input=JsonParser.parseString(raw).getAsJsonObject();id=input.has("requestId")?input.get("requestId").getAsString():null;
            String action=input.has("action")?input.get("action").getAsString():"click";out.addProperty("action",action);
            if(!validRequestId(id)){error(out,"invalid_request_id","error");sendMenu(p,out);return;}out.addProperty("requestId",id);
            if(input.has("schemaVersion")&&(!input.get("schemaVersion").isJsonPrimitive()||!input.get("schemaVersion").getAsJsonPrimitive().isNumber()||input.get("schemaVersion").getAsDouble()!=1)){error(out,"unsupported_schema_version","error");sendMenu(p,out);return;}
            if(!PlayerAuthBridge.authenticated(p)){error(out,"authentication_required","blocked");sendMenu(p,out);return;}
            if(input.has("playerUuid")&&!p.getUUID().toString().equalsIgnoreCase(input.get("playerUuid").getAsString())){error(out,"player_identity_mismatch","blocked");sendMenu(p,out);return;}
            fingerprint=NativePolicy.sha(NativePolicy.canonical(input));ledger=LEDGERS.computeIfAbsent(p.getUUID(),x->new NativePolicy.Receipts(policy.limit("receiptsPerPlayer"),policy.limit("receiptTtlMs")));
            var old=ledger.get(id,System.currentTimeMillis());
            if(old!=null){if(old.fingerprint().equals(fingerprint))sendMenu(p,old.receipt().deepCopy());else{error(out,"request_id_conflict","blocked");sendMenu(p,out);}return;}
            JsonObject args=input.deepCopy();for(String key:List.of("requestId","schemaVersion","playerUuid","action"))args.remove(key);
            var op=policy.operation("menu."+action);
            if(op==null){error(out,"unsupported_native_menu_action","blocked");sendMenu(p,out);return;}
            var problem=NativePolicy.validate(args,op.getAsJsonObject("parameters"),"args");
            if(problem!=null)diagnostic(out,problem,op);
            else if(args.has("expectedServerEpoch")&&!EPOCH.equals(args.get("expectedServerEpoch").getAsString()))error(out,"server_epoch_changed","blocked");
            else{
                int tick=p.getServer().getTickCount();int[] rate=ACTION_RATES.computeIfAbsent(p.getUUID(),x->new int[]{tick,0});
                if(rate[0]!=tick){rate[0]=tick;rate[1]=0;}
                if(rate[1]++>=4){error(out,"native_action_rate_limited","blocked");out.addProperty("retryable",true);out.addProperty("retryAfterMs",50);ledger.put(id,fingerprint,System.currentTimeMillis(),out);sendMenu(p,out);return;}
                var m=p.containerMenu;int slot=action.equals("close")?-1:args.get("slot").getAsInt(),button=action.equals("close")?0:args.get("button").getAsInt();
                if(m.containerId!=args.get("windowId").getAsInt())error(out,"stale_window","blocked");
                else if(m.getStateId()!=args.get("expectedStateId").getAsInt())error(out,"stale_menu_state","blocked");
                else if(action.equals("close")){
                    JsonObject reservation=out.deepCopy();error(reservation,"action_in_progress_or_unknown","unknown");reservation.add("changed",JsonNull.INSTANCE);
                    ledger.put(id,fingerprint,System.currentTimeMillis(),reservation);began=true;
                    int oldWindow=m.containerId;String oldCursor=snbt(p,m.getCarried());p.closeContainer();
                    boolean changed=p.containerMenu.containerId!=oldWindow||!oldCursor.equals(snbt(p,p.containerMenu.getCarried()));
                    out.addProperty("ok",true);out.addProperty("status","completed");out.addProperty("code",changed?"closed":"no_change");out.addProperty("changed",changed);
                    out.addProperty("outcomeKnown",true);out.addProperty("outcomeUnknown",false);out.addProperty("retryAutomatically",false);
                    out.add("completed",JsonParser.parseString("[\"native_menu_close\"]"));out.add("state",menu(p));publish(p);
                }
                else if(slot>=m.slots.size())error(out,"invalid_slot","error");
                else if(!m.stillValid(p))error(out,"menu_not_valid","blocked");
                else if(p.isDeadOrDying()||p.isSpectator())error(out,"body_cannot_interact","blocked");
                else{
                    ItemStack before=m.getSlot(slot).getItem().copy(),cursor=m.getCarried().copy();
                    String nativeId=before.isEmpty()?"minecraft:air":BuiltInRegistries.ITEM.getKey(before.getItem()).toString();
                    if(!nativeId.equals(args.get("expectedItemId").getAsString())||before.getCount()!=args.get("expectedCount").getAsInt())error(out,"slot_changed","blocked");
                    else if(!snbt(p,before).equals(args.get("expectedSnbt").getAsString()))error(out,"slot_components_changed","blocked");
                    else if(!snbt(p,cursor).equals(args.get("expectedCarriedSnbt").getAsString()))error(out,"cursor_changed","blocked");
                    else if(!before.isEmpty()&&!m.getSlot(slot).mayPickup(p)||!cursor.isEmpty()&&!m.getSlot(slot).mayPlace(cursor)&&before.isEmpty())error(out,"slot_permission_denied","blocked");
                    else{
                        // Reserving before clicked prevents an exception from making the ID replayable.
                        JsonObject reservation=out.deepCopy();error(reservation,"action_in_progress_or_unknown","unknown");reservation.add("changed",JsonNull.INSTANCE);
                        ledger.put(id,fingerprint,System.currentTimeMillis(),reservation);began=true;
                        m.clicked(slot,button,ClickType.PICKUP,p);m.broadcastChanges();
                        boolean changed=!ItemStack.matches(before,m.getSlot(slot).getItem())||!ItemStack.matches(cursor,m.getCarried());
                        out.addProperty("ok",true);out.addProperty("status","completed");out.addProperty("code",changed?"clicked":"no_change");out.addProperty("changed",changed);
                        out.addProperty("outcomeKnown",true);out.addProperty("outcomeUnknown",false);out.addProperty("retryAutomatically",false);
                        out.add("completed",JsonParser.parseString("[\"native_pickup_click\"]"));out.add("state",menu(p));publish(p);
                    }
                }
            }
        }catch(RuntimeException failure){error(out,began?"action_outcome_unknown":"invalid_or_failed_action",began?"unknown":"error");if(began)out.add("changed",JsonNull.INSTANCE);out.addProperty("reason",failure.getClass().getSimpleName());}
        if(!out.has("state")&&PlayerAuthBridge.authenticated(p))try{out.add("state",menu(p));}catch(RuntimeException ignored){out.addProperty("stateUnavailable",true);}
        if(ledger!=null&&id!=null&&fingerprint!=null)ledger.put(id,fingerprint,System.currentTimeMillis(),out);
        sendMenu(p,out);
    }
}
