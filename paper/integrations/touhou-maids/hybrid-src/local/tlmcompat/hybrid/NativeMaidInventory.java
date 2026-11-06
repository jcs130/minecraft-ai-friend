package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskManager;
import com.google.gson.JsonObject;
import java.util.*;
import local.tlmcompat.core.CompatibilityException;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.ItemStack;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.craftbukkit.inventory.CraftItemStack;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.inventory.*;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import net.kyori.adventure.text.Component;

/** Vanilla chest UI operates the ORIGINAL item handler; clicks never write a detached backpack copy. */
public final class NativeMaidInventory implements Listener {
    private final HybridMaidPlugin plugin;
    private final Map<UUID,View> views=new HashMap<>();
    private static final class View implements InventoryHolder {
        final UUID maid;final boolean tasks;final List<String> taskIds;Inventory inventory;boolean equipment;int selectedSlot=-1;
        View(UUID maid,boolean tasks,List<String> taskIds){this.maid=maid;this.tasks=tasks;this.taskIds=taskIds;}
        public Inventory getInventory(){return inventory;}
    }
    public NativeMaidInventory(HybridMaidPlugin plugin){this.plugin=plugin;}
    public static int capacity(EntityMaid maid){return Math.min(maid.getMaidInv().getSlots(),maid.getMaidBackpackType().getAvailableMaxContainerIndex());}
    private static int integer(String value,int min,int max){try{int number=Integer.parseInt(value);if(number>=min&&number<=max)return number;}catch(NumberFormatException ignored){}throw new CompatibilityException("bad_slot_or_count","Read current inventory slots");}
    public JsonObject transfer(Player actor,EntityMaid maid,String arguments){
        String[] values=arguments==null?new String[0]:arguments.split(" +");
        if(values.length<3||values.length>4||!Set.of("put","take").contains(values[0]))throw new CompatibilityException("bad_transfer","transfer expects put|take maidSlot count [playerSlot]");
        int slot=integer(values[1],0,capacity(maid)-1),count=integer(values[2],1,64);
        int playerSlot=values.length==4?integer(values[3],0,35):-1;var handler=maid.getMaidInv();
        if(values[0].equals("put")){
            if(playerSlot<0)throw new CompatibilityException("player_slot_required","Use the exact observed player slot");
            ItemStack source=CraftItemStack.asNMSCopy(actor.getInventory().getItem(playerSlot));
            if(source.isEmpty()||source.getCount()<count)throw new CompatibilityException("item_missing","Player source changed");
            ItemStack destination=handler.getStackInSlot(slot);
            if(!handler.isItemValid(slot,source)||(!destination.isEmpty()&&!ItemStack.isSameItemSameComponents(source,destination)))throw new CompatibilityException("slot_rejected","Original native handler refused this item");
            int limit=Math.min(handler.getSlotLimit(slot),source.getMaxStackSize());
            if(destination.getCount()+count>limit)throw new CompatibilityException("slot_full","Native slot capacity exceeded");
            ItemStack updated=source.copyWithCount(destination.getCount()+count);new com.github.tartaricacid.touhoulittlemaid.inventory.container.MaidMainContainer.BackpackSlot(maid,slot,0,0).setByPlayer(updated);
            source.shrink(count);actor.getInventory().setItem(playerSlot,source.isEmpty()?null:CraftItemStack.asBukkitCopy(source));
        }else{
            ItemStack source=handler.getStackInSlot(slot);
            if(source.isEmpty()||source.getCount()<count)throw new CompatibilityException("item_missing","Native source changed");
            if(!VanillaMaidProjection.nativeClient(actor)&&!net.minecraft.core.registries.BuiltInRegistries.ITEM.getKey(source.getItem()).getNamespace().equals("minecraft"))throw new CompatibilityException("mod_item_requires_native_client","Item retained in native inventory");
            if(playerSlot<0){for(int candidate=0;candidate<36;candidate++){ItemStack old=CraftItemStack.asNMSCopy(actor.getInventory().getItem(candidate));if(old.isEmpty()||(ItemStack.isSameItemSameComponents(source,old)&&old.getCount()+count<=old.getMaxStackSize())){playerSlot=candidate;break;}}}
            if(playerSlot<0)throw new CompatibilityException("player_inventory_full","No player slot can hold this stack");
            ItemStack old=CraftItemStack.asNMSCopy(actor.getInventory().getItem(playerSlot));
            if((!old.isEmpty()&&!ItemStack.isSameItemSameComponents(source,old))||old.getCount()+count>source.getMaxStackSize())throw new CompatibilityException("player_slot_full","Destination changed or cannot hold the transfer");
            ItemStack updated=source.copyWithCount(old.getCount()+count);ItemStack remaining=source.copy();remaining.shrink(count);
            handler.setStackInSlot(slot,remaining);actor.getInventory().setItem(playerSlot,CraftItemStack.asBukkitCopy(updated));
            new com.github.tartaricacid.touhoulittlemaid.inventory.container.MaidMainContainer.BackpackSlot(maid,slot,0,0).onTake(((org.bukkit.craftbukkit.entity.CraftPlayer)actor).getHandle(),source.copyWithCount(count));
        }
        actor.updateInventory();JsonObject result=new JsonObject();result.addProperty("maidId",maid.getUUID().toString());result.addProperty("maidSlot",slot);result.addProperty("playerSlot",playerSlot);result.addProperty("count",count);return result;
    }
    private static final Map<String,EquipmentSlot> EQUIPMENT=Map.of("main",EquipmentSlot.MAINHAND,"off",EquipmentSlot.OFFHAND,"head",EquipmentSlot.HEAD,"chest",EquipmentSlot.CHEST,"legs",EquipmentSlot.LEGS,"feet",EquipmentSlot.FEET);
    public static JsonObject equipment(EntityMaid maid){JsonObject result=new JsonObject();EQUIPMENT.forEach((name,slot)->result.add(name,HybridMaidPlugin.item(maid.getItemBySlot(slot))));return result;}
    public void validateEquip(Player actor,EntityMaid maid,String arguments){
        String[] values=arguments==null?new String[0]:arguments.split(" +");
        if(values.length!=2||!EQUIPMENT.containsKey(values[0]))throw new CompatibilityException("bad_equipment","/qdmaid equip <UUID> <requestId> main|off|head|chest|legs|feet <女仆背包槽>；先 inventory 查槽位，空槽可卸装。");
        int slot=integer(values[1],0,capacity(maid)-1);EquipmentSlot target=EQUIPMENT.get(values[0]);
        ItemStack before=maid.getItemBySlot(target),incoming=maid.getMaidInv().getStackInSlot(slot);
        if(target.getType()==EquipmentSlot.Type.HUMANOID_ARMOR){
            if(!incoming.isEmpty()&&(incoming.getCount()!=1||!((net.neoforged.neoforge.common.extensions.IItemStackExtension)(Object)incoming).canEquip(target,maid)||!incoming.getItem().canFitInsideContainerItems()))
                throw new CompatibilityException("wrong_armor","该物品不能装备到 "+values[0]+"；请放入一件对应部位的护甲，再查 inventory。");
            if(!before.isEmpty()&&actor.getGameMode()!=org.bukkit.GameMode.CREATIVE&&net.minecraft.world.item.enchantment.EnchantmentHelper.has(before,net.minecraft.world.item.enchantment.EnchantmentEffectComponents.PREVENT_ARMOR_CHANGE))
                throw new CompatibilityException("binding_curse","当前护甲具有绑定诅咒，原生规则不允许卸下；本次没有转移物品。");
        }
        if(!before.isEmpty()&&(!maid.getMaidInv().isItemValid(slot,before)||before.getCount()>maid.getMaidInv().getSlotLimit(slot)))
            throw new CompatibilityException("slot_rejected","原装备无法放回该女仆背包槽；先清理一个允许的槽位。");
    }
    public JsonObject equip(Player actor,EntityMaid maid,String arguments){
        validateEquip(actor,maid,arguments);String[] values=arguments.split(" +");int slot=Integer.parseInt(values[1]);EquipmentSlot target=EQUIPMENT.get(values[0]);
        ItemStack before=maid.getItemBySlot(target).copy(),incoming=maid.getMaidInv().getStackInSlot(slot).copy();
        maid.getMaidInv().setStackInSlot(slot,before);maid.setItemSlot(target,incoming);
        JsonObject result=new JsonObject();result.addProperty("maidId",maid.getUUID().toString());result.add("equipment",equipment(maid));result.add("mainHand",HybridMaidPlugin.item(maid.getMainHandItem()));result.add("offHand",HybridMaidPlugin.item(maid.getOffhandItem()));return result;
    }
    public void open(Player actor,EntityMaid maid){
        plugin.ownedLoaded(actor,maid.getUUID());plugin.requireNearby(actor,maid,8);
        View view=new View(maid.getUUID(),false,List.of());view.inventory=Bukkit.createInventory(view,54,Component.text(maid.getName().getString()+" · 原生背包"));
        views.put(actor.getUniqueId(),view);refresh(view,maid);actor.openInventory(view.inventory);
    }
    private void openEquipment(Player actor,EntityMaid maid){
        View view=new View(maid.getUUID(),false,List.of());view.equipment=true;
        view.inventory=Bukkit.createInventory(view,54,Component.text(maid.getName().getString()+" · 武器护甲"));views.put(actor.getUniqueId(),view);
        for(int i=0;i<36;i++)view.inventory.setItem(i,i<capacity(maid)?(maid.getMaidInv().getStackInSlot(i).isEmpty()?button(Material.LIGHT_GRAY_STAINED_GLASS_PANE,"槽 "+i+"：空（可用于卸装）"):visible(maid.getMaidInv().getStackInSlot(i))):button(Material.GRAY_STAINED_GLASS_PANE,"未解锁"));
        var parts=List.of("main","off","head","chest","legs","feet");var labels=List.of("主手","副手","头盔","胸甲","护腿","靴子");
        for(int i=0;i<6;i++){var item=maid.getItemBySlot(EQUIPMENT.get(parts.get(i)));var icon=item.isEmpty()?button(Material.ARMOR_STAND,labels.get(i)+"：空"):visible(item);var meta=icon.getItemMeta();meta.displayName(Component.text(labels.get(i)+" · 点击与所选背包槽交换"));icon.setItemMeta(meta);view.inventory.setItem(36+i,icon);}
        view.inventory.setItem(49,button(Material.CHEST,"返回背包存取"));view.inventory.setItem(53,button(Material.PAPER,"先选上方槽，再选装备部位；不操作玩家光标物品"));actor.openInventory(view.inventory);
    }
    private void openTasks(Player actor,EntityMaid maid){
        List<String> ids=TaskManager.getTaskMap().keySet().stream().map(Object::toString).sorted().toList();View view=new View(maid.getUUID(),true,ids);
        view.inventory=Bukkit.createInventory(view,54,Component.text(maid.getName().getString()+" · 工作模式"));views.put(actor.getUniqueId(),view);
        for(int i=0;i<Math.min(45,ids.size());i++){var task=TaskManager.getTaskMap().get(ResourceLocation.parse(ids.get(i)));var icon=visible(task.getIcon());var meta=icon.getItemMeta();meta.displayName(Component.text(ids.get(i)));meta.lore(List.of(Component.text(task.isEnable(maid)?"可选择":"先满足原模式的工具和物品要求")));icon.setItemMeta(meta);view.inventory.setItem(i,icon);}
        view.inventory.setItem(49,button(Material.CHEST,"返回背包"));actor.openInventory(view.inventory);
    }
    private static org.bukkit.inventory.ItemStack visible(ItemStack stack){
        if(stack.isEmpty())return null;
        if(net.minecraft.core.registries.BuiltInRegistries.ITEM.getKey(stack.getItem()).getNamespace().equals("minecraft"))return CraftItemStack.asBukkitCopy(stack);
        return button(Material.BARRIER,net.minecraft.core.registries.BuiltInRegistries.ITEM.getKey(stack.getItem())+" ×"+stack.getCount()+"（原物品保存在女仆中）");
    }
    private static org.bukkit.inventory.ItemStack button(Material type,String text){var stack=new org.bukkit.inventory.ItemStack(type);var meta=stack.getItemMeta();meta.displayName(Component.text(text));stack.setItemMeta(meta);return stack;}
    private void refresh(View view,EntityMaid maid){
        for(int i=0;i<45;i++)view.inventory.setItem(i,i<capacity(maid)?visible(maid.getMaidInv().getStackInSlot(i)):button(Material.GRAY_STAINED_GLASS_PANE,"未解锁的原生背包槽位"));
        view.inventory.setItem(45,button(Material.LIME_DYE,"跟随"));view.inventory.setItem(46,button(Material.RED_DYE,"停留"));
        view.inventory.setItem(47,button(Material.CLOCK,"日程："+maid.getSchedule()));view.inventory.setItem(48,button(Material.HOPPER,"拾取："+maid.isPickup()));
        view.inventory.setItem(49,button(Material.IRON_SWORD,"选择原生工作模式"));view.inventory.setItem(53,button(Material.ARMOR_STAND,"武器与护甲管理（先存进女仆背包）"));
        view.inventory.setItem(50,button(Material.PLAYER_HEAD,"更换皮肤"));view.inventory.setItem(51,button(Material.NOTE_BLOCK,"更换语音 / 试听"));view.inventory.setItem(52,button(Material.BOOK,"加载原语音素材"));
    }
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)public void click(InventoryClickEvent event){
        if(!(event.getView().getTopInventory().getHolder() instanceof View view))return;event.setCancelled(true);
        if(!(event.getWhoClicked() instanceof Player actor))return;
        try{
            EntityMaid maid=plugin.ownedLoaded(actor,view.maid);plugin.requireNearby(actor,maid,8);int raw=event.getRawSlot();
            if(event.getClick()!=ClickType.LEFT&&event.getClick()!=ClickType.RIGHT)return;
            if(view.equipment){
                if(raw==49){open(actor,maid);return;}
                if(raw>=0&&raw<capacity(maid)&&raw<36){view.selectedSlot=raw;actor.sendMessage("已选女仆背包槽 "+raw+"；点击下方装备部位。选择空槽可卸下。");return;}
                if(raw>=36&&raw<42){if(view.selectedSlot<0)throw new CompatibilityException("select_slot","先点击上方一个女仆背包槽，再点击主手、副手或护甲部位。");String part=List.of("main","off","head","chest","legs","feet").get(raw-36);plugin.dispatch(actor,"equip",view.maid,UUID.randomUUID().toString(),part+" "+view.selectedSlot);openEquipment(actor,maid);return;}
                return;
            }
            if(raw==53&&!view.tasks){openEquipment(actor,maid);return;}
            if(view.tasks){if(raw==49){open(actor,maid);return;}if(raw>=0&&raw<view.taskIds.size()&&raw<45)plugin.dispatch(actor,"task",view.maid,UUID.randomUUID().toString(),view.taskIds.get(raw));return;}
            if(raw==49){openTasks(actor,maid);return;}
            if(raw==50||raw==51){plugin.openCosmetics(actor,maid,raw==51,0);return;}
            if(raw==52){plugin.dispatch(actor,"resource-pack",view.maid,UUID.randomUUID().toString(),null);return;}
            if(raw>=45&&raw<=48){String action=switch(raw){case 45->"follow";case 46->"stay";case 47->"schedule";default->"pickup";};String value=raw==47?com.github.tartaricacid.touhoulittlemaid.entity.ai.brain.MaidSchedule.values()[(maid.getSchedule().ordinal()+1)%3].name():raw==48?Boolean.toString(!maid.isPickup()):null;plugin.dispatch(actor,action,view.maid,UUID.randomUUID().toString(),value);}
            else if(raw>=0&&raw<capacity(maid)){
                ItemStack stack=maid.getMaidInv().getStackInSlot(raw);if(!stack.isEmpty())plugin.dispatch(actor,"transfer",view.maid,UUID.randomUUID().toString(),"take "+raw+" "+(event.isRightClick()?1:Math.min(64,stack.getCount())));
            }else if(event.getClickedInventory()==actor.getInventory()&&event.getSlot()>=0&&event.getSlot()<36){
                ItemStack source=CraftItemStack.asNMSCopy(actor.getInventory().getItem(event.getSlot()));if(!source.isEmpty()){
                    for(int slot=0;slot<Math.min(45,capacity(maid));slot++){ItemStack old=maid.getMaidInv().getStackInSlot(slot);int room=Math.min(source.getMaxStackSize(),maid.getMaidInv().getSlotLimit(slot))-old.getCount();
                        if(room>0&&maid.getMaidInv().isItemValid(slot,source)&&(old.isEmpty()||ItemStack.isSameItemSameComponents(source,old))){plugin.dispatch(actor,"transfer",view.maid,UUID.randomUUID().toString(),"put "+slot+" "+(event.isRightClick()?1:Math.min(Math.min(source.getCount(),room),64))+" "+event.getSlot());break;}}
                }
            }
            refresh(view,maid);
        }catch(Exception error){actor.sendMessage(Component.text("未执行："+(error instanceof CompatibilityException compat?compat.code()+"："+compat.getMessage():"操作未确认，请关闭菜单后查询原回执。")));}
        Bukkit.getScheduler().runTask(plugin,actor::updateInventory);
    }
    @EventHandler(ignoreCancelled=true,priority=EventPriority.HIGHEST)public void drag(InventoryDragEvent event){if(event.getView().getTopInventory().getHolder() instanceof View)event.setCancelled(true);}
    @EventHandler public void close(InventoryCloseEvent event){View current=views.get(event.getPlayer().getUniqueId());if(current!=null&&current.inventory==event.getInventory())views.remove(event.getPlayer().getUniqueId());}
    public void closeAll(){for(UUID id:new ArrayList<>(views.keySet())){Player player=Bukkit.getPlayer(id);if(player!=null)player.closeInventory();}views.clear();}
}
