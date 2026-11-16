package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import java.util.UUID;
import net.minecraft.world.item.ItemStack;

/** Narrow in-process bridge. Native inventory remains authoritative; never inserts a player into PlayerList. */
public final class ResidentBodyAccess {
    private static EntityMaid body(UUID id){var r=MaidAgentsMod.residents();var b=r==null?null:r.body(id);if(r==null||r.role(id)==null||b==null||!b.isAlive())throw new IllegalArgumentException("resident_body_unavailable");return b;}
    public static Object entity(UUID id)throws Exception{return body(id).getClass().getMethod("getBukkitEntity").invoke(body(id));}
    public static int capacity(UUID id){var b=body(id);return Math.min(b.getMaidInv().getSlots(),b.getMaidBackpackType().getAvailableMaxContainerIndex());}
    public static Object item(UUID id,int slot)throws Exception{
        if(slot<0||slot>=capacity(id))throw new IllegalArgumentException("resident_slot_out_of_range");
        return Class.forName("org.bukkit.craftbukkit.inventory.CraftItemStack").getMethod("asBukkitCopy",ItemStack.class).invoke(null,body(id).getMaidInv().getStackInSlot(slot));
    }
    public static void item(UUID id,int slot,Object value)throws Exception{
        var b=body(id);if(slot<0||slot>=capacity(id))throw new IllegalArgumentException("resident_slot_out_of_range");
        var item=(ItemStack)Class.forName("org.bukkit.craftbukkit.inventory.CraftItemStack").getMethod("asNMSCopy",Class.forName("org.bukkit.inventory.ItemStack")).invoke(null,value);
        if(!item.isEmpty()&&!b.getMaidInv().isItemValid(slot,item))throw new IllegalArgumentException("native_inventory_refused");
        b.getMaidInv().setStackInSlot(slot,item);
    }
    public static boolean mana(UUID id,double amount,boolean spend){
        if(!Double.isFinite(amount)||amount<0||amount>1000)throw new IllegalArgumentException("invalid_mana_amount");
        var value=ResidentRpg.data(body(id));double current=value.getDouble("mana");if(current<amount)return false;
        if(spend)value.putDouble("mana",current-amount);return true;
    }
}
