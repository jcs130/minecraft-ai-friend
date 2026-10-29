package org.qiandengji.mcbot;

import com.dwinovo.numen.api.entity.NumenPlayer;
import com.dwinovo.numen.api.entity.Sight;
import net.minecraft.core.BlockPos;
import net.minecraft.world.phys.Vec3;
import org.bukkit.block.Block;

/** Same shape-aware sight primitive as native interactions; no underground scans. */
final class Perception {
    private Perception() {}
    static boolean visible(NumenPlayer body,Block block){return visible(body,new BlockPos(block.getX(),block.getY(),block.getZ()));}
    static boolean visible(NumenPlayer body,BlockPos pos){
        var level=body.serverLevel();if(!level.hasChunkAt(pos))return false;
        Vec3 eye=body.getEyePosition();
        for(Vec3 face:Sight.faces(level,eye,pos))if(Sight.trace(level,eye,face,pos).clear(null))return true;
        return false;
    }
}
