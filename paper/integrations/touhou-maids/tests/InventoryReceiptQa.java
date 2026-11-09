package local.tlmcompat.qa;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import org.bukkit.*;
import org.bukkit.craftbukkit.CraftWorld;
import org.bukkit.craftbukkit.entity.CraftEntity;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

/** Console-only fixture: a fixed synthetic owner, fresh native maid, no production data. */
public final class InventoryReceiptQa extends JavaPlugin {
    private static final String NAME="MaidSlotQA0";
    private static final UUID OWNER=UUID.nameUUIDFromBytes(("OfflinePlayer:"+NAME).getBytes(StandardCharsets.UTF_8));
    private final Path identity=Path.of("inventory-receipt-qa.json");
    private UUID maidId;
    public void onEnable(){
        try{
            if(Bukkit.getPort()!=25938||!Bukkit.getIp().equals("127.0.0.1")||!Files.readString(Path.of(".maid-lifecycle-qa")).equals("FRESH_MAID_LIFECYCLE_QA_NO_PLAYER_DATA"))throw new IllegalStateException("Isolated synthetic fixture only");
            if(Files.exists(identity))maidId=UUID.fromString(JsonParser.parseString(Files.readString(identity)).getAsJsonObject().get("maidId").getAsString());
        }catch(Exception error){throw new IllegalStateException(error);}
        getCommand("maidinvqa").setExecutor((sender,command,label,args)->{
            if(sender instanceof Player||args.length!=1)return false;
            try{
                Player owner=Bukkit.getPlayerExact(NAME);if(owner==null||!owner.getUniqueId().equals(OWNER))throw new IllegalStateException("Synthetic owner required");
                if(args[0].equals("respawn")){if(!owner.isDead())throw new IllegalStateException("Synthetic player must be dead");owner.spigot().respawn();sender.sendMessage("MAID_INVENTORY_QA_RESPAWN_REQUESTED");return true;}
                if(args[0].equals("setup")){
                    if(maidId!=null)throw new IllegalStateException("Do not recreate an existing fixture");
                    var level=((CraftWorld)owner.getWorld()).getHandle();var maid=new EntityMaid(level);
                    maid.setOwnerUUID(OWNER);maid.setTame(true,false);maid.setNoAi(true);maid.setPersistenceRequired();maid.setCustomName(net.minecraft.network.chat.Component.literal("隔离背包女仆"));
                    var loc=owner.getLocation();maid.moveTo(loc.getX()+2,loc.getY(),loc.getZ(),0,0);
                    if(!level.addFreshEntity(maid,org.bukkit.event.entity.CreatureSpawnEvent.SpawnReason.CUSTOM))throw new IllegalStateException("Spawn refused");
                    maidId=maid.getUUID();JsonObject id=new JsonObject();id.addProperty("synthetic",true);id.addProperty("maidId",maidId.toString());id.addProperty("ownerId",OWNER.toString());Files.writeString(identity,id.toString());
                    Bukkit.dispatchCommand(Bukkit.getConsoleSender(),"qdmaid bind "+maidId);
                }
                if(maidId==null||!(Bukkit.getEntity(maidId) instanceof CraftEntity craft)||!(craft.getHandle() instanceof EntityMaid maid)||!OWNER.equals(maid.getOwnerUUID()))throw new IllegalStateException("Original synthetic maid unavailable");
                switch(args[0]){
                    case "setup","fill"->{
                        for(int i=0;i<maid.getMaidInv().getSlots();i++)maid.getMaidInv().setStackInSlot(i,i<6?new ItemStack(Items.COBBLESTONE,64):ItemStack.EMPTY);
                        for(var slot:net.minecraft.world.entity.EquipmentSlot.values())maid.setItemSlot(slot,ItemStack.EMPTY);
                        owner.getInventory().clear();var armor=new org.bukkit.inventory.ItemStack(Material.IRON_CHESTPLATE);var meta=armor.getItemMeta();meta.displayName(net.kyori.adventure.text.Component.text("原组件测试胸甲"));meta.setUnbreakable(true);armor.setItemMeta(meta);owner.getInventory().setItem(35,armor);owner.updateInventory();
                    }
                    case "free"->maid.getMaidInv().setStackInSlot(0,ItemStack.EMPTY);
                    case "snapshot"->{}
                    default->throw new IllegalArgumentException("setup|fill|free|snapshot");
                }
                JsonObject data=new JsonObject();data.addProperty("synthetic",true);data.addProperty("maidId",maidId.toString());data.addProperty("ownerId",OWNER.toString());
                JsonArray slots=new JsonArray(),equipment=new JsonArray(),player=new JsonArray();
                for(int i=0;i<maid.getMaidInv().getSlots();i++)slots.add(stack(maid,maid.getMaidInv().getStackInSlot(i)));
                for(var slot:net.minecraft.world.entity.EquipmentSlot.values())equipment.add(stack(maid,maid.getItemBySlot(slot)));
                for(int i=0;i<36;i++)player.add(stack(maid,org.bukkit.craftbukkit.inventory.CraftItemStack.asNMSCopy(owner.getInventory().getItem(i))));
                data.add("slots",slots);data.add("equipment",equipment);data.add("player",player);sender.sendMessage("MAID_INVENTORY_QA "+data);
            }catch(Exception error){sender.sendMessage("MAID_INVENTORY_QA_ERROR "+error);}
            return true;
        });
    }
    private static String stack(EntityMaid maid,ItemStack stack){return stack.saveOptional(maid.level().registryAccess()).toString();}
}
