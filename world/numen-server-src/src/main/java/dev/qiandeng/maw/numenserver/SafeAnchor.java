package dev.qiandeng.maw.numenserver;

import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.tags.BlockTags;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

/** Small bounded safe-spawn search; no dependence on Numen's package-private helper. */
final class SafeAnchor {
    static Vec3 near(ServerLevel level,Vec3 center) {
        BlockPos origin=BlockPos.containing(center);
        for(int dy=-1;dy<=8;dy++)for(int radius=0;radius<=3;radius++)for(int dx=-radius;dx<=radius;dx++)for(int dz=-radius;dz<=radius;dz++){
            if(Math.max(Math.abs(dx),Math.abs(dz))!=radius)continue;
            BlockPos pos=origin.offset(dx,dy,dz),below=pos.below();
            if(!level.getWorldBorder().isWithinBounds(pos))continue;
            var floor=level.getBlockState(below);var feet=level.getBlockState(pos);var head=level.getBlockState(pos.above());
            if(!floor.isFaceSturdy(level,below,Direction.UP)||floor.is(Blocks.MAGMA_BLOCK)||floor.is(Blocks.CACTUS)||floor.is(Blocks.CAMPFIRE)||floor.is(Blocks.SOUL_CAMPFIRE))continue;
            if(feet.is(BlockTags.FIRE)||head.is(BlockTags.FIRE)||!feet.getFluidState().isEmpty()||!head.getFluidState().isEmpty())continue;
            double x=pos.getX()+.5,y=pos.getY(),z=pos.getZ()+.5;
            if(level.noCollision(new AABB(x-.3,y,z-.3,x+.3,y+1.8,z+.3)))return new Vec3(x,y,z);
        }return null;
    }
}
