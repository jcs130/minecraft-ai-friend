package local.tlmcompat.qa;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskManager;
import java.util.*;
import org.bukkit.*;
import org.bukkit.craftbukkit.entity.CraftEntity;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.plugin.java.JavaPlugin;
public final class CompanionStateQa extends JavaPlugin {
    private final Set<UUID> mobs=new HashSet<>();
    public void onEnable(){
        if(Bukkit.getPort()!=25938||!java.nio.file.Files.exists(java.nio.file.Path.of(".maid-lifecycle-qa")))throw new IllegalStateException("Isolated synthetic fixture only");
        getCommand("companionqa").setExecutor((sender,command,label,args)->{
            if(sender instanceof org.bukkit.entity.Player||args.length!=2)return false;
            var e=Bukkit.getEntity(UUID.fromString(args[1]));if(!(e instanceof CraftEntity craft)||!(craft.getHandle() instanceof EntityMaid maid))return false;
            switch(args[0]){
                case "arm"->{maid.setItemSlot(net.minecraft.world.entity.EquipmentSlot.MAINHAND,new net.minecraft.world.item.ItemStack(net.minecraft.world.item.Items.IRON_SWORD));maid.setHealth(20);maid.setTask(TaskManager.getIdleTask());maid.setInSittingPose(false);maid.setHomeModeEnable(false);}
                case "threat"->{var owner=Bukkit.getPlayer(maid.getOwnerUUID());if(!(owner instanceof CraftPlayer player))return false;var z=(org.bukkit.entity.Zombie)e.getWorld().spawnEntity(e.getLocation().add(2,0,0),org.bukkit.entity.EntityType.ZOMBIE);z.setAI(false);z.getAttribute(org.bukkit.attribute.Attribute.GENERIC_MAX_HEALTH).setBaseValue(1000);z.setHealth(1000);z.setSilent(true);mobs.add(z.getUniqueId());((net.minecraft.world.entity.Mob)((CraftEntity)z).getHandle()).setTarget(player.getHandle());}
                case "clear"->{for(UUID id:mobs){var mob=Bukkit.getEntity(id);if(mob!=null)mob.remove();}mobs.clear();}
                case "diagnostics"->{for(UUID id:mobs){var mob=Bukkit.getEntity(id);if(mob instanceof CraftEntity c&&c.getHandle() instanceof net.minecraft.world.entity.Mob nativeMob){var task=(com.github.tartaricacid.touhoulittlemaid.api.task.IAttackTask)TaskManager.getTaskMap().get(net.minecraft.resources.ResourceLocation.parse("touhou_little_maid:attack"));sender.sendMessage("synthetic mob="+id+" target="+(nativeMob.getTarget()==null?"none":nativeMob.getTarget().getUUID())+" los="+maid.hasLineOfSight(nativeMob)+" nativeAllowed="+task.canAttack(maid,nativeMob)+" withinOldHome="+maid.isWithinRestriction(nativeMob.blockPosition())+" distance="+maid.distanceTo(nativeMob));}}}
                case "low"->maid.setHealth(3);
                case "heal"->maid.setHealth(20);
                case "resume-marker"->{maid.getPersistentData().putString("qiandengji_auto_defence_task","touhou_little_maid:attack");maid.setTask(TaskManager.getTaskMap().get(net.minecraft.resources.ResourceLocation.parse("touhou_little_maid:attack")));}
                default->{return false;}
            }sender.sendMessage("synthetic_companion_"+args[0]);return true;
        });
    }
}
