package org.afuhome.agentfriend;

import java.util.UUID;
import java.util.Set;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.block.data.Ageable;

/** Internal native event adapter. Not exposed as a command or model tool. */
public final class ResidentWorldActions {
    private static final Set<Material> CROPS=Set.of(Material.WHEAT,Material.CARROTS,Material.POTATOES,Material.BEETROOTS);
    public static void crop(UUID id,String action,int x,int y,int z,String blockId) {
        if(!Bukkit.isPrimaryThread()||!ResidentCli.isResident(id))throw new IllegalArgumentException("resident_identity_required");
        var player=ResidentCli.find(id);if(player==null||player.isDead())return;
        if(!player.getWorld().isChunkLoaded(x>>4,z>>4))return;
        var block=player.getWorld().getBlockAt(x,y,z);Material crop=Material.matchMaterial(blockId);
        if(crop==null||!CROPS.contains(crop)||player.getLocation().distanceSquared(block.getLocation())>64)return;
        boolean young=block.getType()==crop&&block.getBlockData() instanceof Ageable age&&age.getAge()==0;
        String location=block.getWorld().getUID()+":"+x+":"+y+":"+z;
        var plugin=(AgentFriendPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");
        if(action.equals("harvest")&&(block.getType().isAir()||young))plugin.taskMarket().harvest(player,crop.name(),location);
        else if(action.equals("replant")&&young&&plugin.taskMarket().harvested(player,crop.name(),location))
            plugin.taskMarket().replanted(player,crop.name(),location);
    }
}
