package local.qdj.maids.brain.mixin;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import local.qdj.maids.brain.ResidentActivity;
import net.minecraft.core.BlockPos;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.state.BlockState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(value=EntityMaid.class,remap=false)
public abstract class ResidentPlantActivityMixin {
    @Unique private BlockState qdj$beforePlant;
    @Unique private int qdj$seedCount;
    @Inject(method="placeItemBlock(Lnet/minecraft/core/BlockPos;Lnet/minecraft/world/item/ItemStack;)Z",at=@At("HEAD"),remap=false)
    private void beforePlant(BlockPos pos,ItemStack seed,CallbackInfoReturnable<Boolean> ci){
        qdj$beforePlant=((EntityMaid)(Object)this).level().getBlockState(pos);qdj$seedCount=seed.getCount();
    }
    @Inject(method="placeItemBlock(Lnet/minecraft/core/BlockPos;Lnet/minecraft/world/item/ItemStack;)Z",at=@At("RETURN"),remap=false)
    private void afterPlant(BlockPos pos,ItemStack seed,CallbackInfoReturnable<Boolean> ci){
        BlockState before=qdj$beforePlant;qdj$beforePlant=null;
        if(ci.getReturnValueZ()&&before!=null)ResidentActivity.planted((EntityMaid)(Object)this,pos,before,qdj$seedCount-seed.getCount());
    }
}
