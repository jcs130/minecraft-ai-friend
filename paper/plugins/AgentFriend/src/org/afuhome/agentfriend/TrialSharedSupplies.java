package org.afuhome.agentfriend;

import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.block.*;
import org.bukkit.block.data.type.Chest.Type;
import org.bukkit.block.sign.Side;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.block.*;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.inventory.InventoryMoveItemEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;

/** Three real public double chests. Installation is explicit, empty and refuses existing builds. */
final class TrialSharedSupplies implements Listener {
    private static final int X=-583,Y=91;
    private static final int[] Z={-314,-311,-308};
    private static final String[] IDS={"weapons","armor","supplies"},LABELS={"武器共享","护甲共享","箭矢与补给"};
    private final AgentFriendPlugin plugin;
    private final Path receipt;
    TrialSharedSupplies(AgentFriendPlugin plugin){
        this.plugin=plugin;receipt=plugin.getDataFolder().toPath().resolve("trial-shared-installed.txt");
        Bukkit.getPluginManager().registerEvents(this,plugin);
    }
    private World world(){return Bukkit.getWorld("world");}
    private boolean ready(){try{return Files.exists(receipt)&&Files.readString(receipt).equals("installed-v1\n");}catch(Exception unavailable){return false;}}
    private int category(Location at){
        if(at==null||at.getWorld()!=world()||at.getBlockY()!=Y||at.getBlockX()<X||at.getBlockX()>X+1)return -1;
        for(int i=0;i<Z.length;i++)if(at.getBlockZ()==Z[i])return i;return -1;
    }
    private boolean protectedPoint(Location at){
        if(category(at)>=0)return true;
        return at.getWorld()==world()&&at.getBlockX()==X&&at.getBlockY()==Y+1&&Arrays.stream(Z).anyMatch(z->z==at.getBlockZ());
    }
    boolean publicStorage(Block block){
        Location at=block.getLocation();
        if(block.getType()==Material.CHEST)return category(at)>=0&&ready();
        return block.getType()==Material.FURNACE&&at.getWorld()==world()
                &&at.getBlockX()==-585&&at.getBlockY()==Y&&at.getBlockZ()==-313;
    }
    void admin(CommandSender sender,String action){
        if(!Set.of("preview","install","audit").contains(action)){sender.sendMessage("mycli admin trialsupplies preview|install|audit");return;}
        World world=world();if(world==null){sender.sendMessage("MC_TRIAL_SHARED ok=false reason=world_unavailable");return;}
        if(ready()){audit(sender);return;}
        try{
            if(Files.exists(receipt))throw new IllegalStateException("previous_install_requires_review");
            for(int z:Z){
                for(int x=X;x<=X+1;x++)if(!world.getBlockAt(x,Y,z).getType().isAir()
                        ||!world.getBlockAt(x,Y+1,z).getType().isAir()
                        ||!world.getBlockAt(x,Y-1,z).getType().isSolid())throw new IllegalStateException("target_not_empty_or_unsupported:"+x+","+Y+","+z);
            }
            sender.sendMessage("MC_TRIAL_SHARED preview=true world=world x="+X+" y="+Y+" z=-314,-311,-308 doubleChests=3 slots=162 initialItems=0");
            if(!action.equals("install"))return;
            Files.writeString(receipt,"planned-v1\n",StandardOpenOption.CREATE_NEW);
            for(int i=0;i<Z.length;i++){
                for(int half=0;half<2;half++){
                    var data=(org.bukkit.block.data.type.Chest)Material.CHEST.createBlockData();
                    data.setFacing(BlockFace.NORTH);data.setType(half==0?Type.LEFT:Type.RIGHT);
                    world.getBlockAt(X+half,Y,Z[i]).setBlockData(data,false);
                }
                Block top=world.getBlockAt(X,Y+1,Z[i]);top.setType(Material.OAK_SIGN,false);
                Sign sign=(Sign)top.getState();sign.setWaxed(true);
                for(Side side:Side.values()){
                    var face=sign.getSide(side);face.setLine(0,"§6试炼塔共享箱");face.setLine(1,"§e"+LABELS[i]);
                    face.setLine(2,"§a所有人可取放");face.setLine(3,"§7存入即公开分享");
                }
                sign.update(true,false);
                if(!(((Chest)world.getBlockAt(X,Y,Z[i]).getState()).getInventory().getHolder() instanceof DoubleChest))
                    throw new IllegalStateException("double_chest_not_joined");
            }
            Files.writeString(receipt,"installed-v1\n",StandardOpenOption.TRUNCATE_EXISTING);
            audit(sender);
        }catch(Exception error){sender.sendMessage("MC_TRIAL_SHARED ok=false reason="+error.getMessage()+"; no existing inventory overwritten; inspect before retry");}
    }
    private void audit(CommandSender sender){
        boolean intact=ready();for(int z:Z)for(int x=X;x<=X+1;x++)intact&=world().getBlockAt(x,Y,z).getState() instanceof Chest chest&&chest.getInventory().getSize()==54;
        sender.sendMessage("MC_TRIAL_SHARED installed="+ready()+" intact="+intact+" doubleChests=3 slots=162");
    }
    void describe(Player player){
        if(!ready())return;
        player.sendMessage("§6试炼塔入口东侧另有三组公共双箱，所有玩家与Agent可取放。存入即共享；个人仓库10页540格仍独享。");
        for(int i=0;i<Z.length;i++)player.sendMessage("MC_GUILD_SHARED id=trial_"+IDS[i]+" name="+LABELS[i]+" world=world dimension=minecraft:overworld x="+X+" y="+Y+" z="+Z[i]+" scope=public slots=54");
    }
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=false)
    public void open(PlayerInteractEvent event){
        if(!ready()||event.getHand()!=EquipmentSlot.HAND||event.getAction()!=Action.RIGHT_CLICK_BLOCK||event.getClickedBlock()==null||category(event.getClickedBlock().getLocation())<0)return;
        event.setCancelled(true);Player p=event.getPlayer();
        if(plugin.isObserver(p)||plugin.isDowned(p)||plugin.pvpParticipant(p)||p.isDead())return;
        if(p.getLocation().distanceSquared(event.getClickedBlock().getLocation().add(.5,.5,.5))>36)return;
        if(event.getClickedBlock().getState() instanceof Chest chest&&chest.getInventory().getSize()==54){
            p.openInventory(chest.getInventory());p.sendMessage("§e[公共共享箱] 这里的物品所有人可取放；存入即分享。私人装备请存罗盘→个人仓库。");
        }
    }
    @EventHandler(priority=EventPriority.HIGHEST,ignoreCancelled=true)
    public void destroy(BlockBreakEvent e){if(ready()&&protectedPoint(e.getBlock().getLocation())){e.setCancelled(true);e.getPlayer().sendMessage("§e共享设施不可拆除；右键箱子可自由取放。");}}
    @EventHandler public void explosion(EntityExplodeEvent e){if(ready())e.blockList().removeIf(b->protectedPoint(b.getLocation()));}
    @EventHandler public void explosion(BlockExplodeEvent e){if(ready())e.blockList().removeIf(b->protectedPoint(b.getLocation()));}
    @EventHandler public void hopper(InventoryMoveItemEvent e){if(ready()&&(category(e.getSource().getLocation())>=0||category(e.getDestination().getLocation())>=0))e.setCancelled(true);}
}
