package local.qdj.maids.brain;

import com.github.tartaricacid.touhoulittlemaid.entity.ai.brain.MaidSchedule;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.block.BlockMaidBed;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.HorizontalDirectionalBlock;
import net.minecraft.world.level.block.StandingSignBlock;
import net.minecraft.world.level.block.entity.SignBlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.BedPart;

final class ResidentHomes {
    static Map<BlockPos,BlockState> plan(ResidentConfig.Resident r) {
        var h=r.home(); var out=new LinkedHashMap<BlockPos,BlockState>();
        var facing=Direction.byName(h.facing());
        var bed=BuiltInRegistries.BLOCK.get(ResourceLocation.parse("touhou_little_maid:maid_bed"));
        if(!(bed instanceof BlockMaidBed)) throw new IllegalArgumentException("native_maid_bed_unavailable");
        var foot=h.bed().pos().relative(facing.getOpposite());
        if(!h.interior().contains(foot))throw new IllegalArgumentException("bed_foot_outside_home");
        add(out,h.bed().pos(),bed.defaultBlockState().setValue(BlockMaidBed.FACING,facing).setValue(BlockMaidBed.PART,BedPart.HEAD));
        add(out,foot,bed.defaultBlockState().setValue(BlockMaidBed.FACING,facing).setValue(BlockMaidBed.PART,BedPart.FOOT));
        int rotation=switch(h.signFacing()){case "south"->0;case "west"->4;case "north"->8;default->12;};
        add(out,h.sign().pos(),Blocks.OAK_SIGN.defaultBlockState().setValue(StandingSignBlock.ROTATION,rotation));
        for(var f:h.furniture()) {
            var block=BuiltInRegistries.BLOCK.get(ResourceLocation.parse(f.block()));
            // Surveyed furniture only; no commands, inventories, spawners, portals or special NBT in config.
            if(!List.of(Blocks.CRAFTING_TABLE,Blocks.BARREL,Blocks.CHEST,Blocks.FURNACE,Blocks.BOOKSHELF,Blocks.LANTERN,Blocks.OAK_SLAB,Blocks.OAK_STAIRS).contains(block))
                throw new IllegalArgumentException("unsupported_furniture");
            add(out,f.at().pos(),block.defaultBlockState());
        }
        return out;
    }
    private static void add(Map<BlockPos,BlockState> plan,BlockPos p,BlockState s) {
        if(plan.putIfAbsent(p,s)!=null) throw new IllegalArgumentException("overlapping_furniture");
    }
    static Map<String,Object> inspect(ServerLevel level,ResidentConfig.Resident r) {
        var plan=plan(r); var blocked=new java.util.ArrayList<Map<String,Object>>();
        for(var e:plan.entrySet()) {
            var p=e.getKey();
            if(!level.hasChunkAt(p)) { blocked.add(Map.of("at",ResidentActions.point(p),"reason","chunk_unloaded"));continue; }
            var current=level.getBlockState(p);
            if(!current.isAir()) blocked.add(Map.of("at",ResidentActions.point(p),"reason","occupied","block",ResidentActions.block(level,p)));
            if(!level.getBlockState(p.below()).isFaceSturdy(level,p.below(),Direction.UP))
                blocked.add(Map.of("at",ResidentActions.point(p),"reason","solid_floor_required"));
        }
        return Map.of("status",blocked.isEmpty()?"ready":"blocked","changes",plan.entrySet().stream().map(e->Map.of("at",ResidentActions.point(e.getKey()),"state",e.getValue().toString())).toList(),"conflicts",blocked);
    }
    static void furnish(ServerLevel level,ResidentConfig.Resident r) {
        var report=inspect(level,r);
        if(!"ready".equals(report.get("status"))) throw new IllegalArgumentException("house_preflight_failed_no_blocks_written");
        // Administrator provisioning only. Autonomous work always goes through ordinary item/protection rules.
        // Preflight the whole small plan before changing the first block; never replace existing furniture.
        var plan=plan(r);
        // Install the two bed halves before notifying neighbours; otherwise the first half removes itself.
        for(var e:plan.entrySet()) if(!level.setBlock(e.getKey(),e.getValue(),2)) throw new IllegalStateException("house_install_partial_read_original_receipt");
        for(var e:plan.entrySet())level.updateNeighborsAt(e.getKey(),e.getValue().getBlock());
        for(var e:plan.entrySet())if(!level.getBlockState(e.getKey()).equals(e.getValue()))throw new IllegalStateException("furniture_state_not_verified");
        if(!(level.getBlockEntity(r.home().sign().pos()) instanceof SignBlockEntity sign)) throw new IllegalStateException("sign_not_created");
        var text=sign.getText(true).setMessage(0,Component.literal(r.name()+"的家"))
            .setMessage(1,Component.literal(ResidentRpg.title(r.profession())))
            .setMessage(2,Component.literal("欢迎来访 · 请先敲门"));
        sign.setText(text,true); sign.setText(text,false); sign.setWaxed(true); sign.setChanged();
        level.sendBlockUpdated(sign.getBlockPos(),sign.getBlockState(),sign.getBlockState(),3);
    }
    static void bind(EntityMaid maid,ResidentConfig.Resident r) {
        var h=r.home(); var s=maid.getSchedulePos();
        maid.setHomeModeEnable(true); maid.setInSittingPose(false); maid.setSchedule(MaidSchedule.DAY);
        s.setDimension(ResourceLocation.parse(h.dimension())); s.setWorkPos(h.work().pos());
        s.setIdlePos(h.door().pos());s.setSleepPos(h.bed().pos());s.setConfigured(true);s.restrictTo(maid);
        MaidAgent.task(maid,ResourceLocation.parse(r.nativeTask()));
    }
}
