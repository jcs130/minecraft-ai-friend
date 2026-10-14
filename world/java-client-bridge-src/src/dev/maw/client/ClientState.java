package dev.maw.client;

import com.google.gson.*;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.components.events.ContainerEventHandler;
import net.minecraft.client.gui.components.events.GuiEventListener;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.phys.*;
import java.time.Instant;
import java.util.*;

/** All methods run on the original client's game/render thread, never a synthetic world. */
final class ClientState {
    private Object lastScreen, lastConnection;
    private String screenToken = UUID.randomUUID().toString(), connectionId = UUID.randomUUID().toString();
    private long tick;
    private long messageSeq;
    private final ArrayDeque<JsonObject> messages=new ArrayDeque<>();
    String server(Minecraft mc) { return mc.getCurrentServer() == null ? (mc.isLocalServer() ? "singleplayer" : "") : mc.getCurrentServer().ip; }
    void tick(Minecraft mc) {
        tick++;
        if (lastScreen != mc.screen) { lastScreen = mc.screen; screenToken = UUID.randomUUID().toString(); }
        updateConnection(mc);
    }
    private void updateConnection(Minecraft mc){if(lastConnection!=mc.getConnection()){lastConnection=mc.getConnection();connectionId=UUID.randomUUID().toString();messages.clear();}}
    void message(Minecraft mc,net.neoforged.neoforge.client.event.ClientChatReceivedEvent event){
        updateConnection(mc);
        messages.add(object("seq",++messageSeq,"at",Instant.now(),"connectionId",connectionId,"text",event.getMessage().getString(),
            "senderUuid",event.getSender(),"system",event.isSystem(),"overlay",event instanceof net.neoforged.neoforge.client.event.ClientChatReceivedEvent.System s&&s.isOverlay(),
            "visibility","received_on_this_connection"));
        while(messages.size()>128)messages.removeFirst();
    }
    JsonObject messages(Minecraft mc,int after,int limit){
        JsonArray out=new JsonArray();for(JsonObject message:messages)if(message.get("seq").getAsLong()>after&&out.size()<limit)out.add(message.deepCopy());
        return object("ok",true,"bodyId",mc.player.getUUID(),"connectionId",connectionId,"latestSeq",messageSeq,"messages",out,"retainedLimit",128);
    }
    String screenToken() { return screenToken; }
    String connectionId() { return connectionId; }
    long tick() { return tick; }
    static JsonObject object(Object... fields) {
        JsonObject o = new JsonObject();
        for (int i=0;i<fields.length;i+=2) {
            String key = fields[i].toString(); Object v = fields[i+1];
            if (v == null) o.add(key, JsonNull.INSTANCE);
            else if (v instanceof JsonElement j) o.add(key,j);
            else if (v instanceof Boolean b) o.addProperty(key,b);
            else if (v instanceof Number n) o.addProperty(key,n);
            else o.addProperty(key,v.toString());
        }
        return o;
    }
    static JsonObject pos(Vec3 p) { return object("x",p.x,"y",p.y,"z",p.z); }
    static JsonObject pos(BlockPos p) { return object("x",p.getX(),"y",p.getY(),"z",p.getZ()); }
    JsonObject snapshot(Minecraft mc) {
        boolean online=mc.player != null && mc.level != null && mc.getConnection()!=null;
        JsonObject value = object("schemaVersion",1,"provider","java-client","bodyKind","connected_java_client",
            "ok",online,"status",online?(mc.player.isAlive()?"alive":"dead"):"offline","online",online,
            "bodyId",online?mc.player.getUUID():null,"playerUuid",online?mc.player.getUUID():null,
            "username",online?mc.player.getGameProfile().getName():null,"server",server(mc),"connectionId",connectionId,
            "capturedAt",Instant.now(),"capturedTick",tick,"sampling","client_tick","authority","client_observed",
            "mana",null,"currentAction",null,"screen",screen(mc));
        if (!online) return value;
        value.add("position",pos(mc.player.position()));
        value.addProperty("dimension",mc.level.dimension().location().toString());
        value.addProperty("health",mc.player.getHealth()); value.addProperty("maxHealth",mc.player.getMaxHealth());
        value.addProperty("hunger",mc.player.getFoodData().getFoodLevel()); value.addProperty("saturation",mc.player.getFoodData().getSaturationLevel());
        value.addProperty("yaw",mc.player.getYRot()); value.addProperty("pitch",mc.player.getXRot());
        value.addProperty("onGround",mc.player.onGround()); value.addProperty("selectedHotbarSlot",mc.player.getInventory().selected);
        value.addProperty("experienceLevel",mc.player.experienceLevel); value.addProperty("experienceProgress",mc.player.experienceProgress);
        JsonArray inventory=new JsonArray(), items=new JsonArray();
        for (Slot slot:mc.player.inventoryMenu.slots) {
            JsonObject stack=item(mc,slot.getItem()); inventory.add(stack);
            if(stack != null) { JsonObject i=stack.deepCopy();i.addProperty("slot",slot.index);items.add(i); }
        }
        value.add("inventory",object("available",true,"slotNamespace","player_menu_46","slots",inventory,"items",items));
        value.add("equipment",object("mainhand",item(mc,mc.player.getMainHandItem()),"offhand",item(mc,mc.player.getOffhandItem()),
            "head",item(mc,mc.player.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.HEAD)),
            "chest",item(mc,mc.player.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.CHEST)),
            "legs",item(mc,mc.player.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.LEGS)),
            "feet",item(mc,mc.player.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.FEET))));
        value.add("menu",menu(mc)); value.add("hit",hit(mc));
        return value;
    }
    JsonObject item(Minecraft mc,ItemStack stack) {
        if(stack.isEmpty())return null;
        // save() runs the actual mod codecs with this connection's dynamic registries.
        var tag=stack.save(mc.level.registryAccess());
        JsonArray types=new JsonArray();for(var type:stack.getComponents().keySet())types.add(String.valueOf(BuiltInRegistries.DATA_COMPONENT_TYPE.getKey(type)));
        return object("id",BuiltInRegistries.ITEM.getKey(stack.getItem()),"type",BuiltInRegistries.ITEM.getId(stack.getItem()),
            "name",stack.getHoverName().getString(),"count",stack.getCount(),"maxStackSize",stack.getMaxStackSize(),
            "damage",stack.getDamageValue(),"maxDamage",stack.getMaxDamage(),"componentTypes",types,
            "componentsSnbt",tag instanceof CompoundTag c&&c.contains("components")?c.get("components").toString():"{}","snbt",tag.toString());
    }
    String snbt(Minecraft mc,ItemStack stack) { return stack.isEmpty()?"":stack.save(mc.level.registryAccess()).toString(); }
    JsonObject menu(Minecraft mc) {
        var menu=mc.player.containerMenu;JsonArray slots=new JsonArray();
        for(Slot slot:menu.slots)slots.add(object("slot",slot.index,"inventoryIndex",slot.getContainerSlot(),
            "owner",slot.container==mc.player.getInventory()?"player":"container","x",slot.x,"y",slot.y,
            "mayPickup",slot.mayPickup(mc.player),"item",item(mc,slot.getItem())));
        return object("playerUuid",mc.player.getUUID(),"windowId",menu.containerId,"stateId",menu.getStateId(),
            "className",menu.getClass().getName(),"slots",slots,"carried",item(mc,menu.getCarried()),
            "screenToken",screenToken,"title",mc.screen==null?"":mc.screen.getTitle().getString());
    }
    JsonObject screen(Minecraft mc) {
        JsonArray widgets=new JsonArray();
        if(mc.screen!=null) widgets(mc.screen.children(),"",widgets,0);
        return object("open",mc.screen!=null,"token",screenToken,"className",mc.screen==null?null:mc.screen.getClass().getName(),
            "title",mc.screen==null?null:mc.screen.getTitle().getString(),"width",mc.getWindow().getGuiScaledWidth(),
            "height",mc.getWindow().getGuiScaledHeight(),"framebufferWidth",mc.getMainRenderTarget().width,
            "framebufferHeight",mc.getMainRenderTarget().height,"widgets",widgets,
            "textFieldValuesExported",false,"customDrawnControlsMayRequirePixels",true);
    }
    private void widgets(List<? extends GuiEventListener> children,String path,JsonArray result,int depth) {
        if(depth>6)return;
        for(int i=0;i<children.size()&&result.size()<128;i++) {
            var child=children.get(i);String key=path.isEmpty()?""+i:path+"."+i;
            if(child instanceof AbstractWidget w)result.add(object("path",key,"className",w.getClass().getName(),"label",w.getMessage().getString(),
                "x",w.getX(),"y",w.getY(),"width",w.getWidth(),"height",w.getHeight(),"active",w.active,"visible",w.visible,
                "textInput",w instanceof EditBox));
            if(child instanceof ContainerEventHandler container)widgets(container.children(),key,result,depth+1);
        }
    }
    JsonObject hit(Minecraft mc) {
        if(mc.hitResult==null)return null;
        JsonObject out=object("type",mc.hitResult.getType().name().toLowerCase(),"position",pos(mc.hitResult.getLocation()));
        if(mc.hitResult instanceof BlockHitResult b){out.add("blockPosition",pos(b.getBlockPos()));out.addProperty("face",b.getDirection().getName());}
        if(mc.hitResult instanceof EntityHitResult e){out.addProperty("entityId",e.getEntity().getId());out.addProperty("uuid",e.getEntity().getUUID().toString());}
        return out;
    }
    JsonObject block(Minecraft mc,BlockPos p) {
        if(mc.level==null||!mc.level.hasChunkAt(p))return object("available",false,"position",pos(p),"code","chunk_not_loaded");
        var state=mc.level.getBlockState(p);JsonObject props=new JsonObject();
        state.getValues().forEach((property,v)->props.addProperty(property.getName(),v.toString()));
        JsonArray shapes=new JsonArray();for(var box:state.getCollisionShape(mc.level,p).toAabbs()){
            JsonArray a=new JsonArray();for(double v:new double[]{box.minX,box.minY,box.minZ,box.maxX,box.maxY,box.maxZ})a.add(v);shapes.add(a);
        }
        return object("available",true,"position",pos(p),"id",BuiltInRegistries.BLOCK.getKey(state.getBlock()),
            "type",BuiltInRegistries.BLOCK.getId(state.getBlock()),"stateId",Block.getId(state),"properties",props,
            "collisionShapes",shapes,"destroySpeed",state.getDestroySpeed(mc.level,p),"isAir",state.isAir(),
            "fluid",state.getFluidState().isEmpty()?null:BuiltInRegistries.FLUID.getKey(state.getFluidState().getType()));
    }
    JsonObject observe(Minecraft mc,int radius) {
        JsonArray blocks=new JsonArray(),entities=new JsonArray();BlockPos center=mc.player.blockPosition();
        for(BlockPos p:BlockPos.betweenClosed(center.offset(-radius,-radius,-radius),center.offset(radius,radius,radius)))blocks.add(block(mc,p));
        for(Entity entity:mc.level.entitiesForRendering())if(entity!=mc.player && entity.distanceToSqr(mc.player)<=(radius*radius*4)){
            JsonObject e=object("entityId",entity.getId(),"uuid",entity.getUUID(),"type",BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()),
                "name",entity.getDisplayName().getString(),"position",pos(entity.position()),"alive",entity.isAlive(),
                "lineOfSight",mc.player.hasLineOfSight(entity));
            if(entity instanceof LivingEntity l){e.addProperty("health",l.getHealth());e.addProperty("maxHealth",l.getMaxHealth());}
            entities.add(e);
        }
        return object("ok",true,"bodyId",mc.player.getUUID(),"capturedAt",Instant.now(),"capturedTick",tick,
            "source","client_loaded_world","lineOfSightFiltered",false,"center",pos(center),"radius",radius,
            "blocks",blocks,"entities",entities);
    }
}
