package local.qdj.maids.brain;

import com.google.gson.Gson;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import net.minecraft.core.BlockPos;
import net.minecraft.resources.ResourceLocation;

/** Explicit resident identities and surveyed homes. Loading a config never creates bodies or edits a world. */
record ResidentConfig(int schema, int planningSeconds, List<Resident> residents) {
    record Point(int x, int y, int z) { BlockPos pos() { return new BlockPos(x,y,z); } }
    record Area(Point min, Point max) {
        boolean contains(BlockPos p) { return p.getX()>=min.x && p.getX()<=max.x && p.getY()>=min.y && p.getY()<=max.y && p.getZ()>=min.z && p.getZ()<=max.z; }
        long volume() { return (1L+max.x-min.x)*(1L+max.y-min.y)*(1L+max.z-min.z); }
        void validate() {
            if(min==null||max==null||min.x>max.x||min.y>max.y||min.z>max.z||
                (long)max.x-min.x>64||(long)max.y-min.y>32||(long)max.z-min.z>64||volume()>32768)
                throw new IllegalArgumentException("resident_area_invalid_or_too_large");
        }
    }
    record Furniture(Point at, String block) {}
    record Appearance(String modelId,String texture,String sha256){}
    record Home(String dimension, Point door, Point bed, String facing, Point sign, String signFacing,
                Point work, Area interior, List<Furniture> furniture) {}
    record Resident(UUID maidId, String name, String profession, String nativeTask, Home home,
                    Area workArea, List<String> mineBlocks, List<String> buildBlocks, boolean autonomous, Appearance appearance,boolean roamingWork,Boolean combatEnabled,String controller,List<UUID> allies) {
        boolean combat(){return !Boolean.FALSE.equals(combatEnabled);}
        boolean external(){return "unified".equals(controller);}
        boolean allied(UUID other){return external()&&allies!=null&&allies.contains(other);}
    }
    static ResidentConfig read(Path path, MaidAgentsServer agents) throws java.io.IOException {
        if(!Files.exists(path)) return new ResidentConfig(1,180,List.of());
        if(Files.size(path)>128*1024) throw new IllegalArgumentException("residents_config_too_large");
        var c=new Gson().fromJson(Files.readString(path),ResidentConfig.class);
        if(c==null||c.schema!=1||c.planningSeconds<30||c.planningSeconds>3600||c.residents==null||c.residents.size()>24)
            throw new IllegalArgumentException("invalid_residents_config");
        var ids=new HashSet<UUID>(); var names=new HashSet<String>(); var beds=new HashSet<String>();
        for(var r:c.residents) {
            if(r!=null&&r.controller!=null&&!List.of("native","unified").contains(r.controller))throw new IllegalArgumentException("invalid_resident_controller");
            if(r!=null&&r.allies!=null&&(r.allies.size()>16||r.allies.contains(null)||new HashSet<>(r.allies).size()!=r.allies.size()))throw new IllegalArgumentException("invalid_resident_allies");
            if(r==null||r.maidId==null||agents.agent(r.maidId)==null||!ids.add(r.maidId)||!text(r.name,24)||
                !names.add(r.name)||!List.of("guardian","ranger","mage","healer","artisan","farmer","knight","cleric","engineer","beastmaster").contains(r.profession))
                throw new IllegalArgumentException("invalid_resident_identity_or_profession");
            ResourceLocation.parse(r.nativeTask);
            if(r.appearance!=null&&(r.appearance.modelId==null||!r.appearance.modelId.matches("[A-Za-z0-9_-][A-Za-z0-9_.-]{0,110}\\.ysm")||
                !text(r.appearance.texture,96)||r.appearance.sha256==null||!r.appearance.sha256.matches("[a-f0-9]{64}")))
                throw new IllegalArgumentException("resident_appearance: hashed .ysm modelId and texture required");
            var h=r.home;
            if(h==null||h.door==null||h.bed==null||h.sign==null||h.work==null||h.interior==null||
                !List.of("north","south","east","west").contains(h.facing)||
                !List.of("north","south","east","west").contains(h.signFacing)||h.furniture==null||h.furniture.size()>16)
                throw new IllegalArgumentException("invalid_resident_home");
            ResourceLocation.parse(h.dimension); h.interior.validate();
            if(!h.interior.contains(h.bed.pos())||!beds.add(h.dimension+":"+h.bed)) throw new IllegalArgumentException("bed_shared_or_outside_home");
            for(var f:h.furniture) {
                if(f==null||f.at==null||!h.interior.contains(f.at.pos())) throw new IllegalArgumentException("furniture_outside_home");
                ResourceLocation.parse(f.block);
            }
            if(r.workArea!=null) r.workArea.validate();
            if(r.mineBlocks==null||r.buildBlocks==null)throw new IllegalArgumentException("resident_mineBlocks_and_buildBlocks_arrays_required");
            for(var blocks:List.of(r.mineBlocks,r.buildBlocks)) {
                if(blocks.size()>32) throw new IllegalArgumentException("too_many_resident_block_types");
                blocks.forEach(ResourceLocation::parse);
            }
        }
        return c;
    }
    static boolean text(String s,int max) { return s!=null&&!s.isBlank()&&s.codePointCount(0,s.length())<=max&&!s.codePoints().anyMatch(Character::isISOControl); }
}
