package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.block.Block;
import org.bukkit.util.Vector;

/** 25 bounded camera rays; never generates terrain or scans entities. Runs once per photograph. */
final class PhotoScene {
    static JsonObject inspect(Location eye,double pitch,JsonObject context) {
        Vector forward=new Vector(-Math.sin(Math.toRadians(eye.getYaw()))*Math.cos(pitch),Math.sin(pitch),Math.cos(Math.toRadians(eye.getYaw()))*Math.cos(pitch));
        Vector right=new Vector(Math.cos(Math.toRadians(eye.getYaw())),0,Math.sin(Math.toRadians(eye.getYaw())));
        Vector up=forward.clone().crossProduct(right).normalize();
        int loaded=0,near=0,subjects=0;Set<Integer> bands=new HashSet<>();
        double fov=Math.tan(Math.toRadians(35));
        for(int y=-2;y<=2;y++)for(int x=-2;x<=2;x++) {
            Vector direction=forward.clone().add(right.clone().multiply(x/2.0*fov*.85)).add(up.clone().multiply(y/2.0*fov*.85)).normalize();
            boolean known=true;
            for(double d=.2;d<=48;d+=.4) {
                Location at=eye.clone().add(direction.clone().multiply(d));
                if(at.getY()<eye.getWorld().getMinHeight()||at.getY()>=eye.getWorld().getMaxHeight())break;
                if(!eye.getWorld().isChunkLoaded(at.getBlockX()>>4,at.getBlockZ()>>4)){known=false;break;}
                Block b=at.getBlock();if(b.isEmpty()||b.isPassable()&&!b.isLiquid())continue;
                if(d<2.5)near++;
                if(d>=2.5&&subject(at,context)){subjects++;bands.add(d<8?0:d<20?1:2);}
                break;
            }
            if(known)loaded++;
        }
        JsonObject out=new JsonObject();out.addProperty("loadedRays",loaded);out.addProperty("nearRays",near);
        out.addProperty("subjectRays",subjects);out.addProperty("depthBands",bands.size());return out;
    }
    private static boolean subject(Location at,JsonObject context) {
        if(context==null)return true;
        if(context.has("bounds")&&!context.get("bounds").getAsString().isEmpty()) {
            String[] box=context.get("bounds").getAsString().split(":"),min=box[0].split(","),max=box[1].split(",");
            return at.getBlockX()>=Integer.parseInt(min[0])&&at.getBlockX()<=Integer.parseInt(max[0])
                    &&at.getBlockY()>=Integer.parseInt(min[1])&&at.getBlockY()<=Integer.parseInt(max[1])
                    &&at.getBlockZ()>=Integer.parseInt(min[2])&&at.getBlockZ()<=Integer.parseInt(max[2]);
        }
        if(context.has("targetX"))return Math.hypot(at.getX()-context.get("targetX").getAsInt(),at.getZ()-context.get("targetZ").getAsInt())<=context.get("radius").getAsInt();
        // A regional photograph must show the biome where its photographer is standing.
        return !context.has("biome")||WorldBiomes.at(at).equals(context.get("biome").getAsString());
    }
}
