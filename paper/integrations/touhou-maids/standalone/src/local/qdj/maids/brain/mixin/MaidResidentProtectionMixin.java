package local.qdj.maids.brain.mixin;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import local.qdj.maids.brain.ResidentProtection;
import net.minecraft.core.BlockPos;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Also covers original farming and addons which honor TLM's existing canDestroy/canPlace contract. */
@Mixin(value=EntityMaid.class,remap=false)
public abstract class MaidResidentProtectionMixin {
    @Inject(method="canDestroyBlock",at=@At("RETURN"),cancellable=true,remap=false)
    private void residentBreak(BlockPos pos,CallbackInfoReturnable<Boolean> result) {
        if(result.getReturnValueZ()&&!ResidentProtection.nativeAllowed((EntityMaid)(Object)this,"break",pos))result.setReturnValue(false);
    }
    @Inject(method="canPlaceBlock",at=@At("RETURN"),cancellable=true,remap=false)
    private void residentPlace(BlockPos pos,CallbackInfoReturnable<Boolean> result) {
        if(result.getReturnValueZ()&&!ResidentProtection.nativeAllowed((EntityMaid)(Object)this,"place",pos))result.setReturnValue(false);
    }
}
