package org.afuhome.agentfriend;

import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldguard.WorldGuard;
import com.sk89q.worldguard.bukkit.WorldGuardPlugin;
import com.sk89q.worldguard.protection.flags.Flags;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.Player;

/** Native entity teleport events do not run player session handlers. Recheck entry/exit as this NPC. */
public final class ResidentTravelAccess {
    public static boolean allowed(UUID actor,UUID worldId,double x,double y,double z){
        if(!Bukkit.isPrimaryThread()||!ResidentCli.isResident(actor)||!Double.isFinite(x)||!Double.isFinite(y)||!Double.isFinite(z))return false;
        var world=Bukkit.getWorld(worldId);var body=ResidentCli.find(actor);
        if(world==null||body==null||!world.isChunkLoaded(((int)Math.floor(x))>>4,((int)Math.floor(z))>>4))return false;
        var target=new Location(world,x,y,z);if(!world.getWorldBorder().isInside(target)||y<world.getMinHeight()||y>=world.getMaxHeight())return false;
        try{
            var query=WorldGuard.getInstance().getPlatform().getRegionContainer().createQuery();
            for(boolean departure:new boolean[]{true,false}){
                var at=departure?body.getLocation():target;
                var principal=(Player)ResidentCli.nativeCall("principal",new Class[]{UUID.class,UUID.class,double.class,double.class,double.class},actor,at.getWorld().getUID(),at.getX(),at.getY(),at.getZ());
                if(principal.isOp()||!query.testState(BukkitAdapter.adapt(at),WorldGuardPlugin.inst().wrapPlayer(principal),departure?Flags.EXIT:Flags.ENTRY))return false;
            }
            return true;
        }catch(ReflectiveOperationException|LinkageError|RuntimeException unavailable){return false;}
    }
    private ResidentTravelAccess(){}
}
