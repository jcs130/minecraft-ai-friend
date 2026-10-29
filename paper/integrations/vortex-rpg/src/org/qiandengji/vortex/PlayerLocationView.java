package org.qiandengji.vortex;

import java.util.LinkedHashMap;
import java.util.Map;
import org.bukkit.Bukkit;
import org.bukkit.World;
import org.bukkit.entity.Player;

/** Read current Bukkit world instances, never infer proximity from XYZ or dimension type. */
public final class PlayerLocationView {
    private PlayerLocationView() {}

    public static Map<String,Object> location(Player player) {
        if(!Bukkit.isPrimaryThread())throw new IllegalStateException("main thread required");
        World world=player.getWorld();var at=player.getLocation();
        return Map.of("world",Map.of("name",world.getName(),"key",world.getKey().toString(),
            "uuid",world.getUID().toString(),"label",label(world)),
            "position",Map.of("x",at.getBlockX(),"y",at.getBlockY(),"z",at.getBlockZ()));
    }

    public static Map<String,Object> relative(Player viewer,Player member) {
        if(!Bukkit.isPrimaryThread())throw new IllegalStateException("main thread required");
        var out=new LinkedHashMap<String,Object>();
        boolean online=member!=null&&member.isOnline();out.put("online",online);
        if(!online)return out; // Unknown/offline positions are not stale "nearby" evidence.
        out.put("location",location(member));
        boolean same=viewer.getWorld().getUID().equals(member.getWorld().getUID());
        out.put("sameWorld",same);
        if(same)out.put("distance",Math.round(viewer.getLocation().distance(member.getLocation())*10.0)/10.0);
        else out.put("distanceUnavailableReason","different_world");
        return out;
    }

    public static String text(Player player) {
        var at=player.getLocation();
        return label(player.getWorld())+" ("+player.getWorld().getKey()+") "+at.getBlockX()+","+at.getBlockY()+","+at.getBlockZ();
    }

    public static String relativeText(Player viewer,Player member) {
        var view=relative(viewer,member);
        if(!Boolean.TRUE.equals(view.get("online")))return "离线，位置未知";
        return text(member)+(Boolean.TRUE.equals(view.get("sameWorld"))?"，距你"+view.get("distance")+"格":"，不同世界，不能比较距离");
    }

    private static String label(World world) {
        return switch(world.getName()) {
            case "world"->"主世界";case "aincrad"->"艾恩葛朗特";
            case "world_nether"->"下界";case "world_the_end"->"末地";
            default->world.getName();
        };
    }
}
