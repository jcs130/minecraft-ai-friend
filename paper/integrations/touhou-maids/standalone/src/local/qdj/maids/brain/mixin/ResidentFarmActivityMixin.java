package local.qdj.maids.brain.mixin;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskNormalFarm;
import local.qdj.maids.brain.ResidentActivity;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.block.state.BlockState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(value=TaskNormalFarm.class,remap=false)
public abstract class ResidentFarmActivityMixin {
    @Unique private BlockState qdj$originalCrop;
    @Inject(method="harvest",at=@At("HEAD"),remap=false)
    private void beforeHarvest(EntityMaid maid,BlockPos pos,BlockState before,CallbackInfo ci){qdj$originalCrop=before;}
    @Inject(method="harvest",at=@At("RETURN"),remap=false)
    private void actualHarvest(EntityMaid maid,BlockPos pos,BlockState ignored,CallbackInfo ci){
        // TLM's no-hoe path rewrites its BlockState argument to age zero.
        BlockState before=qdj$originalCrop;qdj$originalCrop=null;
        if(before!=null)ResidentActivity.harvested(maid,pos,before);
    }
}
