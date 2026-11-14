package org.afuhome.compat;

import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldedit.world.item.ItemTypes;
import java.nio.file.Files;
import java.nio.file.Path;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

/** Console-only synthetic fixture. Never included in a production artifact. */
public final class SoulSpellFixture extends JavaPlugin {
    @Override public void onEnable() {
        if (!Bukkit.getIp().equals("127.0.0.1") || Bukkit.getPort() != 25952
                || !Files.exists(Path.of(".soul-spell-qa"))) throw new IllegalStateException("isolated fixture only");
    }
    @Override public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (sender instanceof Player || args.length != 1) return false;
        Player player = Bukkit.getPlayerExact("SoulSpellQA");
        if (player == null) throw new IllegalStateException("synthetic actor absent");
        String item = args[0];
        if (item.equals("prepare-main") || item.equals("prepare-off")) {
            var world=player.getWorld();
            for(int x=-3;x<=3;x++)for(int z=-3;z<=3;z++) {
                world.getBlockAt(x,63,z).setType(org.bukkit.Material.STONE);
                for(int y=64;y<=67;y++)world.getBlockAt(x,y,z).setType(org.bukkit.Material.AIR);
            }
            player.setOp(false);player.setGameMode(org.bukkit.GameMode.SURVIVAL);
            player.teleport(new org.bukkit.Location(world,.5,64,2.5,180,70));
            player.getInventory().clear();
            Bukkit.dispatchCommand(Bukkit.getConsoleSender(),"minecraft:item replace entity SoulSpellQA weapon."+(item.endsWith("off")?"offhand":"mainhand")+" with touhou_little_maid:smart_slab_init");
            sender.sendMessage("QA_PREPARED "+item);return true;
        }
        if(item.equals("inspect")){
            int count=0,owned=0;
            for(var entity:player.getWorld().getEntities())try{
                Object handle=entity.getClass().getMethod("getHandle").invoke(entity);
                if(!handle.getClass().getName().endsWith(".EntityMaid"))continue;
                count++;
                Object owner=handle.getClass().getMethod("getOwnerUUID").invoke(handle);
                if(player.getUniqueId().equals(owner))owned++;
                sender.sendMessage("QA_MAID uuid="+entity.getUniqueId()+" owner="+owner);
            }catch(ReflectiveOperationException failure){throw new IllegalStateException(failure);}
            sender.sendMessage("QA_STATE maids="+count+" owned="+owned+" main="+player.getInventory().getItemInMainHand().getType().getKey()+" off="+player.getInventory().getItemInOffHand().getType().getKey());return true;
        }
        if(item.equals("protect")){
            var manager=com.sk89q.worldguard.WorldGuard.getInstance().getPlatform().getRegionContainer().get(BukkitAdapter.adapt(player.getWorld()));
            var region=new com.sk89q.worldguard.protection.regions.ProtectedCuboidRegion("qa_item_boundary",com.sk89q.worldedit.math.BlockVector3.at(-3,63,-3),com.sk89q.worldedit.math.BlockVector3.at(3,67,3));
            region.setFlag(com.sk89q.worldguard.protection.flags.Flags.BUILD,com.sk89q.worldguard.protection.flags.StateFlag.State.DENY);
            manager.addRegion(region);
            var block=player.getWorld().getBlockAt(0,63,0);
            var event=new org.bukkit.event.block.BlockBreakEvent(block,player);Bukkit.getPluginManager().callEvent(event);
            if(!event.isCancelled())throw new IllegalStateException("QA_PROTECTION_BYPASSED");
            manager.removeRegion(region.getId());sender.sendMessage("QA_PROTECTION preserved=true");return true;
        }
        if (!item.matches("[a-z0-9_:]+")) return false;
        Bukkit.dispatchCommand(Bukkit.getConsoleSender(), "minecraft:item replace entity SoulSpellQA weapon.mainhand with " + item);
        var material = player.getInventory().getItemInMainHand().getType();
        var key = material.getKey().toString();
        if (!key.equals(item)) throw new IllegalStateException("QA_WRONG_ITEM " + key);
        sender.sendMessage("QA_ITEM key=" + key + " ordinal=" + material.ordinal() + " count=" + org.bukkit.Material.values().length
                + " registry=" + ItemTypes.get(key));
        try {
            var mapped = BukkitAdapter.asItemType(material);
            sender.sendMessage("QA_MAP key=" + mapped.id() + " internal=" + mapped.getInternalId());
        } catch (Exception e) { sender.sendMessage("QA_MAP_ERROR " + e.getClass().getSimpleName() + ": " + e.getMessage()); }
        return true;
    }
}
