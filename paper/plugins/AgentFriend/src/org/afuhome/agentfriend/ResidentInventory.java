package org.afuhome.agentfriend;

import java.lang.reflect.Proxy;
import java.util.HashMap;
import java.util.UUID;
import java.util.function.Supplier;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;

/** Storage is the native maid bag. Equipment is separate, never silently sold as a bag slot. */
final class ResidentInventory {
    static PlayerInventory create(UUID id, Supplier<Player> holder) {
        return (PlayerInventory) Proxy.newProxyInstance(ResidentCli.class.getClassLoader(),
            new Class[]{PlayerInventory.class}, (proxy, method, args) -> {
                String name=method.getName();
                if(method.getDeclaringClass()==Object.class)return switch(name){
                    case "toString" -> "ResidentInventory("+id+")";
                    case "hashCode" -> id.hashCode(); case "equals" -> proxy==args[0]; default -> null;};
                int size=(Integer)ResidentCli.nativeCall("capacity",new Class[]{UUID.class},id);
                var body=(LivingEntity)ResidentCli.nativeCall("entity",new Class[]{UUID.class},id);
                var equipment=body.getEquipment();
                return switch(name) {
                    case "getSize" -> size; case "getHolder" -> holder.get();
                    case "getType" -> org.bukkit.event.inventory.InventoryType.PLAYER;
                    case "getMaxStackSize" -> 64;
                    case "getHeldItemSlot" -> -1; // Native main hand is not one of the bag slots.
                    case "getItemInMainHand","getItemInHand" -> equipment.getItemInMainHand();
                    case "getItemInOffHand" -> equipment.getItemInOffHand();
                    case "getArmorContents" -> equipment.getArmorContents();
                    case "getHelmet" -> equipment.getHelmet(); case "getChestplate" -> equipment.getChestplate();
                    case "getLeggings" -> equipment.getLeggings(); case "getBoots" -> equipment.getBoots();
                    case "getItem" -> ResidentCli.nativeCall("item",new Class[]{UUID.class,int.class},id,(Integer)args[0]);
                    case "setItem" -> {ResidentCli.nativeCall("item",new Class[]{UUID.class,int.class,Object.class},id,(Integer)args[0],args[1]);yield null;}
                    case "getStorageContents","getContents" -> contents(id,size);
                    case "setStorageContents","setContents" -> {
                        ResidentCli.nativeCall("replaceStorage",new Class[]{UUID.class,Object[].class},id,(Object)args[0]); yield null;
                    }
                    case "firstEmpty" -> {
                        int empty=-1;ItemStack[] items=contents(id,size);
                        for(int slot=0;slot<size;slot++)if(items[slot]==null||items[slot].getType().isAir()){empty=slot;break;}
                        yield empty;
                    }
                    case "addItem" -> {
                        var leftovers=new HashMap<Integer,ItemStack>();ItemStack[] offered=(ItemStack[])args[0];
                        for(int i=0;i<offered.length;i++){
                            ItemStack left=(ItemStack)ResidentCli.nativeCall("insert",new Class[]{UUID.class,Object.class},id,offered[i]);
                            if(left!=null&&!left.getType().isAir()&&left.getAmount()>0)leftovers.put(i,left);
                        }yield leftovers;
                    }
                    default -> throw new UnsupportedOperationException("resident_inventory_method:"+name);
                };
            });
    }
    private static ItemStack[] contents(UUID id,int size)throws ReflectiveOperationException {
        var items=new ItemStack[size];
        for(int i=0;i<size;i++)items[i]=(ItemStack)ResidentCli.nativeCall("item",new Class[]{UUID.class,int.class},id,i);
        return items;
    }
}
