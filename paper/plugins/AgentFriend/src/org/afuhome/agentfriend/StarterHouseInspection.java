package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.block.Block;
import org.bukkit.block.data.Bisected;
import org.bukkit.block.data.type.Bed;
import org.bukkit.block.data.type.Door;
import org.bukkit.block.data.type.Slab;
import org.bukkit.block.data.type.Stairs;
import org.bukkit.entity.Player;
import static org.afuhome.agentfriend.StarterHouseValidator.*;

final class StarterHouseInspection {
    static String key(Block b) { return b.getWorld().getUID()+":"+b.getX()+":"+b.getY()+":"+b.getZ(); }
    static String record(Block b) { return key(b)+"|"+b.getType().name(); }
    static Result inspect(Player player,List<String> records) {
        World world=player.getWorld();Map<Pos,Material> placed=new LinkedHashMap<>();
        for(String record:records) try {
            String[] split=record.split("\\|",2),parts=split[0].split(":");
            if(parts.length!=4 || !parts[0].equals(world.getUID().toString()))continue;
            placed.put(new Pos(Integer.parseInt(parts[1]),Integer.parseInt(parts[2]),Integer.parseInt(parts[3])),Material.valueOf(split[1]));
        }catch(RuntimeException ignored) { }
        Map<Pos,Kind> cache=new HashMap<>();
        Grid grid=new Grid() {
            public Kind kind(Pos p) {return cache.computeIfAbsent(p,q->{
                if(q.y()<world.getMinHeight() || q.y()>=world.getMaxHeight() || !world.isChunkLoaded(q.x()>>4,q.z()>>4))return Kind.UNKNOWN;
                Block b=world.getBlockAt(q.x(),q.y(),q.z());Material m=b.getType();
                if(b.getBlockData() instanceof Bed bed) {
                    Block other=b.getRelative(bed.getPart()==Bed.Part.FOOT?bed.getFacing():bed.getFacing().getOppositeFace());
                    if(!world.isChunkLoaded(other.getX()>>4,other.getZ()>>4))return Kind.UNKNOWN;
                    if(other.getType()!=m || !(other.getBlockData() instanceof Bed pair) || pair.getPart()==bed.getPart() || pair.getFacing()!=bed.getFacing())return Kind.UNKNOWN;
                    return bed.getPart()==Bed.Part.FOOT?Kind.BED:Kind.BED_HEAD;
                }
                if(b.getBlockData() instanceof Door door) {
                    int dy=door.getHalf()==Bisected.Half.BOTTOM?1:-1;
                    Block other=b.getRelative(0,dy,0);
                    if(other.getType()!=m || !(other.getBlockData() instanceof Door pair) || pair.getHalf()==door.getHalf() || pair.getFacing()!=door.getFacing())return Kind.UNKNOWN;
                    return dy==1?Kind.DOOR:Kind.DOOR_TOP;
                }
                if(m==Material.GLASS || m==Material.TINTED_GLASS || m.name().endsWith("_STAINED_GLASS"))return Kind.GLASS;
                if(m==Material.GLASS_PANE || m.name().endsWith("_STAINED_GLASS_PANE"))return Kind.PANE;
                if(java.util.Set.of(Material.CHEST,Material.TRAPPED_CHEST,Material.BARREL,Material.CRAFTING_TABLE,
                        Material.FURNACE,Material.BLAST_FURNACE,Material.SMOKER,Material.SMITHING_TABLE,
                        Material.CARTOGRAPHY_TABLE,Material.FLETCHING_TABLE,Material.LOOM).contains(m))return Kind.FURNITURE;
                if(m.isOccluding())return Kind.SOLID;
                if(b.getBlockData() instanceof Slab || b.getBlockData() instanceof Stairs)return Kind.ROOF;
                return b.isPassable() && !b.isLiquid()?Kind.AIR:Kind.UNKNOWN;
            });}
            public boolean placed(Pos p) {Material m=placed.get(p);return m!=null && world.isChunkLoaded(p.x()>>4,p.z()>>4) && world.getBlockAt(p.x(),p.y(),p.z()).getType()==m;}
        };
        Result best=StarterHouseValidator.inspect(grid,null);int scanned=0;
        for(Map.Entry<Pos,Material> entry:placed.entrySet()) if(entry.getValue().name().endsWith("_BED")) {
            Pos seed=entry.getKey();if(Math.abs(seed.x()-player.getLocation().getBlockX())>24 || Math.abs(seed.z()-player.getLocation().getBlockZ())>24 || Math.abs(seed.y()-player.getLocation().getBlockY())>12)continue;
            if(grid.kind(seed)!=Kind.BED)continue;
            Result r=StarterHouseValidator.inspect(grid,seed);if(r.ready())return r;if(r.progress()>best.progress())best=r;
            if(++scanned>=4)break;
        }
        return best;
    }
    static JsonObject json(Result r) {
        JsonObject out=new JsonObject();out.addProperty("ready",r.ready());out.addProperty("reason",r.reason());
        out.addProperty("interiorCells",r.interior());out.addProperty("newStructuralBlocks",r.newBlocks());out.addProperty("structuralBlocks",r.structuralBlocks());
        JsonObject c=new JsonObject();String[] ids={"floor","walls","roof","window","door","bed","construction"};
        boolean[] flags={r.floor(),r.walls(),r.roof(),r.window(),r.door(),r.bed(),r.construction()};
        for(int i=0;i<ids.length;i++)c.addProperty(ids[i],flags[i]);out.add("checks",c);
        out.addProperty("nextAction",hint(r));return out;
    }
    static String hint(Result r) {return switch(r.reason()) {
        case "ready"->"房屋七项通过；保持结构完整，用 /mycli life claim 交付。";
        case "place_complete_bed","complete_bed"->"在你接单后建的小屋内亲手放一张完整床，站到24格内再 /mycli life status 验房。";
        case "nearby_chunk_not_loaded"->"靠近房屋让相关区块加载，再 /mycli life status；不要拆已有建筑。";
        case "room_open_or_over_225_cells","close_two_block_high_walls"->"补齐两格高墙体、门的上下半和玻璃窗，不能留通向室外的缺口；单间室内不超过225格，再 life status。";
        case "need_3x3_supported_room"->"至少留3×3室内地面，两格通行净空；地板用完整实心方块，床周围留走路位置，再 life status。";
        case "cover_every_room_column"->"把全部室内上方盖住，屋顶在室内地面上方2至8格；木板、玻璃、台阶或楼梯屋顶均可，再 life status。";
        case "add_glass_window"->"在外墙安至少一格玻璃或玻璃板窗，不能把玻璃随便铺在地上，再 life status。";
        case "add_complete_accessible_door"->"亲手在外墙放完整的两格门，门内外留两格净空和落脚地面，再 life status。";
        default->"接单后亲手放床、外墙窗和门；至少12个现存结构方块且至少一半房屋结构由你建，不能借用旧村屋摆几块木板，再 life status。";
    };}
}
