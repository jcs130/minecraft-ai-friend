package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import java.util.*;
import org.bukkit.*;
import org.bukkit.entity.Player;

/** A bounded terrain check for exploration, not an altitude-only tower-building objective. */
final class PeakSurvey {
    private static final Map<Player,Long> CHECKED=new WeakHashMap<>();
    private static final Set<Material> GROUND=EnumSet.of(Material.STONE,Material.DEEPSLATE,Material.GRASS_BLOCK,
        Material.DIRT,Material.COARSE_DIRT,Material.ROOTED_DIRT,Material.PODZOL,Material.MYCELIUM,Material.GRAVEL,
        Material.SAND,Material.RED_SAND,Material.SANDSTONE,Material.RED_SANDSTONE,Material.TUFF,Material.CALCITE,
        Material.ANDESITE,Material.GRANITE,Material.DIORITE,Material.SNOW_BLOCK,Material.PACKED_ICE,Material.BLUE_ICE,Material.ICE);
    record Result(boolean ready,String reason,int height,int naturalSamples,int loadedSamples,int reads) {
        JsonObject json(){var out=new JsonObject();out.addProperty("ready",ready);out.addProperty("reason",reason);
            out.addProperty("height",height);out.addProperty("minimumHeight",120);out.addProperty("naturalSamples",naturalSamples);
            out.addProperty("requiredSamples",5);out.addProperty("totalSamples",9);out.addProperty("loadedSamples",loadedSamples);
            out.addProperty("blockReads",reads);out.addProperty("readOnly",true);return out;}
    }
    static boolean reached(Player p,Location at) {
        if(!p.isOnGround()||at.getBlockY()<120)return false;
        long now=System.currentTimeMillis(),previous=CHECKED.getOrDefault(p,0L);
        if(now>=previous&&now-previous<1500)return false;
        CHECKED.put(p,now);return inspect(at).ready();
    }
    static Result inspect(Location at) {
        World w=at.getWorld();int height=at.getBlockY();
        if(w==null||w.getEnvironment()!=World.Environment.NORMAL)return new Result(false,"wrong_world",height,0,0,0);
        if(height<120)return new Result(false,"find_mountain",height,0,0,0);
        int x=at.getBlockX(),z=at.getBlockZ();
        if(!w.isChunkLoaded(x>>4,z>>4))return new Result(false,"terrain_unloaded",height,0,0,0);
        if(w.getHighestBlockYAt(x,z,HeightMap.MOTION_BLOCKING_NO_LEAVES)>height+2)
            return new Result(false,"not_open_summit",height,0,1,0);
        int loaded=0,natural=0,reads=0;
        // The surrounding ridge must stay within 12 blocks of the player; a thin column over lowland fails.
        for(int dx:new int[]{-4,0,4})for(int dz:new int[]{-4,0,4}) {
            int xx=x+dx,zz=z+dz;if(!w.isChunkLoaded(xx>>4,zz>>4))continue;loaded++;
            for(int y=Math.min(w.getMaxHeight()-1,height+2);y>=Math.max(w.getMinHeight(),height-12);y--) {
                var b=w.getBlockAt(xx,y,zz);reads++;
                if(b.isLiquid())break;
                if(b.isPassable())continue;
                if(ground(b.getType())) {
                    int depth=1;
                    for(int below=1;below<6&&y-below>=w.getMinHeight();below++) {
                        reads++;if(!ground(w.getBlockAt(xx,y-below,zz).getType()))break;depth++;
                    }
                    if(depth==6)natural++;
                }
                break;
            }
        }
        boolean ready=loaded==9&&natural>=5;
        return new Result(ready,loaded<9?"terrain_unloaded":ready?"summit_observed":"not_mountain_terrain",height,natural,loaded,reads);
    }
    private static boolean ground(Material type){return GROUND.contains(type)||type.name().endsWith("TERRACOTTA");}
    static String requirement(){return "探索主世界或艾恩葛朗特的开阔山地高处（Y≥120），周围须有连片厚实的山地地表；在山脊落地走动记录。平地垫柱、独立屋顶和单根高塔不算；不要求雪山，也不强制建造。";}
    static JsonObject guide(JsonObject original,Result sample) {
        if(original.get("ready").getAsBoolean())return original;
        var out=original.deepCopy();out.add("terrain",sample.json());
        String action=switch(sample.reason()) {
            case "wrong_world"->"先回主世界或艾恩葛朗特探索山地；下界顶板和末地不算。";
            case "terrain_unloaded"->"附近山地尚未加载完整；靠近山脊，等地形加载后落地走动。未查到不代表没有山。";
            case "not_open_summit"->"当前位置在屋顶或封闭空间下；去山脊开阔处，不用拆除建筑。";
            case "not_mountain_terrain"->"当前虽够高，但周边不是连片山地地表；不要继续垫高，沿自然山坡探索。";
            case "summit_observed"->"当前山地条件符合；落地横向走动记录，再查询交付，查询本身不补进度。";
            default->"先探索就近的自然山坡，再沿山脊走到Y≥120；不要在村庄垫柱刷高度。找山太远时可先放弃改做附近路线，历史成绩保留。";
        };
        out.addProperty("phase",sample.ready()?"record_exploration":"explore_mountain");
        out.addProperty("reason",sample.reason().toUpperCase(Locale.ROOT));out.addProperty("nextAction",action
            +" 可选纪念：先查保护权限，在允许建设的山顶建小观景台、拍合影；这两项不作为本单硬门槛。");
        out.getAsJsonArray("missingConditions").add(requirement());return out;
    }
}
