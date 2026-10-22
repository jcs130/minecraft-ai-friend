package dev.qiandeng.maw.numenmods;

import com.google.gson.*;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.inventory.*;
import net.minecraft.world.item.ItemStack;
import net.neoforged.fml.ModList;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;

/** Actual native menu and canonical inventory, including mod ItemStack components. */
final class MenuNative {
    static JsonObject item(ServerPlayer p,ItemStack s){
        if(s.isEmpty())return null;var row=new JsonObject();row.addProperty("id",BuiltInRegistries.ITEM.getKey(s.getItem()).toString());
        row.addProperty("count",s.getCount());row.addProperty("displayName",s.getHoverName().getString());row.addProperty("descriptionId",s.getDescriptionId());
        row.addProperty("snbt",s.saveOptional(p.registryAccess()).toString());return row;
    }
    private static JsonArray slots(ServerPlayer p,AbstractContainerMenu m){var rows=new JsonArray();for(var slot:m.slots)rows.add(item(p,slot.getItem()));return rows;}
    static String hash(ServerPlayer p){
        var out=new JsonObject();out.addProperty("windowId",p.containerMenu.containerId);out.addProperty("stateId",p.containerMenu.getStateId());
        out.add("slots",slots(p,p.containerMenu));out.add("cursor",item(p,p.containerMenu.getCarried()));
        try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(out.toString().getBytes(StandardCharsets.UTF_8)));}
        catch(java.security.NoSuchAlgorithmException impossible){throw new IllegalStateException(impossible);}
    }
    static JsonObject snapshot(ServerPlayer p){
        var m=p.containerMenu;var out=new JsonObject();out.addProperty("schemaVersion",1);out.addProperty("kind","menu_state");out.addProperty("playerUuid",p.getUUID().toString());
        out.addProperty("capturedAt",Instant.now().toString());out.addProperty("windowId",m.containerId);out.addProperty("stateId",m.getStateId());out.addProperty("controlHash",hash(p));
        if(m==p.inventoryMenu)out.addProperty("menuType","minecraft:inventory");
        else try{var id=BuiltInRegistries.MENU.getKey(m.getType());out.addProperty("menuType",id==null?null:id.toString());}catch(RuntimeException e){out.add("menuType",JsonNull.INSTANCE);}
        out.add("slots",slots(p,m));if(m!=p.inventoryMenu)out.add("playerInventory",slots(p,p.inventoryMenu));out.add("carried",item(p,m.getCarried()));
        var layout=new JsonArray();var pickup=new JsonArray();
        for(int i=0;i<m.slots.size();i++){var s=m.getSlot(i);var r=new JsonObject();r.addProperty("slot",i);r.addProperty("x",s.x);r.addProperty("y",s.y);r.addProperty("owner",s.container==p.getInventory()?"player_inventory":"container");r.addProperty("inventoryIndex",s.getContainerSlot());layout.add(r);pickup.add(s.mayPickup(p));}
        out.add("slotLayout",layout);out.add("mayPickup",pickup);out.add("data",data(m));
        var self=new JsonObject();self.addProperty("playerUuid",p.getUUID().toString());self.addProperty("health",p.getHealth());self.addProperty("maxHealth",p.getMaxHealth());
        self.addProperty("food",p.getFoodData().getFoodLevel());self.addProperty("saturation",p.getFoodData().getSaturationLevel());
        self.add("mana",ModList.get().isLoaded("irons_spellbooks")?IronNative.mana(p):JsonNull.INSTANCE);
        var equipment=new JsonObject();for(var s:List.of(EquipmentSlot.MAINHAND,EquipmentSlot.OFFHAND,EquipmentSlot.HEAD,EquipmentSlot.CHEST,EquipmentSlot.LEGS,EquipmentSlot.FEET))equipment.add(s.getName(),item(p,p.getItemBySlot(s)));self.add("equipment",equipment);out.add("self",self);
        return out;
    }
    private static JsonArray data(AbstractContainerMenu m){
        try{var f=AbstractContainerMenu.class.getDeclaredField("dataSlots");f.setAccessible(true);var result=new JsonArray();for(var s:(List<?>)f.get(m))result.add(((DataSlot)s).get());return result;}
        catch(ReflectiveOperationException e){throw new IllegalStateException("native_menu_progress_unavailable",e);}
    }
    static JsonObject invoke(ServerPlayer p,String id,JsonObject args){
        var result=new JsonObject();result.addProperty("ok",true);
        boolean started=false;
        try {
        if(!id.equals("menu.snapshot")){
            var m=p.containerMenu;
            if(m.containerId!=args.get("windowId").getAsInt()||m.getStateId()!=args.get("expectedStateId").getAsInt())throw new IllegalArgumentException("stale_menu_state");
            if(args.has("expectedControlHash")&&!hash(p).equals(args.get("expectedControlHash").getAsString()))throw new IllegalArgumentException("menu_components_or_cursor_changed");
            if(!m.stillValid(p))throw new IllegalArgumentException("menu_not_accessible");
            if(id.equals("menu.close")){
                if(!m.getCarried().isEmpty())throw new IllegalArgumentException("clear_cursor_before_close");if(m!=p.inventoryMenu){started=true;p.closeContainer();}
            }else if(id.equals("menu.button")){started=true;result.addProperty("ok",m.clickMenuButton(p,args.get("buttonId").getAsInt()));result.addProperty("effectVerified",false);}
            else{
                int slot=args.get("slot").getAsInt(),button=args.get("button").getAsInt();var type=ClickType.valueOf(args.get("clickType").getAsString());
                if(!(slot==-999||slot>=0&&slot<m.slots.size()))throw new IllegalArgumentException("invalid_menu_slot");
                boolean allowed=switch(type){case PICKUP,QUICK_MOVE,THROW,PICKUP_ALL->button<=1;case SWAP->button<=8||button==40;case CLONE->button==2&&p.getAbilities().instabuild;case QUICK_CRAFT->Set.of(0,1,2,4,5,6,8,9,10).contains(button)&&(button/4!=2||p.getAbilities().instabuild);};
                if(!allowed||slot==-999&&type!=ClickType.PICKUP&&type!=ClickType.QUICK_CRAFT)throw new IllegalArgumentException("invalid_click_button_or_permission");
                started=true;m.clicked(slot,button,type,p);
            }
            p.containerMenu.broadcastChanges();
        }
        result.add("state",snapshot(p));return result;
        }catch(RuntimeException failure){
            if(started)throw new IllegalStateException("native_menu_outcome_unknown_check_state",failure);
            throw failure;
        }
    }
}
