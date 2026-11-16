package local.qdj.maids.brain.mixin;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import local.qdj.maids.brain.MaidAgentsMod;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Pause only native walking during a pending photo; physics, damage and ordinary AI stay enabled. */
@Mixin(value=EntityMaid.class,remap=false)
public abstract class MaidResidentMotionMixin {
    @Inject(method="canBrainMoving",at=@At("HEAD"),cancellable=true,remap=false)
    private void residentPhotoPose(CallbackInfoReturnable<Boolean> result) {
        var maid=(EntityMaid)(Object)this;
        if(!maid.level().isClientSide&&(MaidAgentsMod.residentHoldsPosition(maid.getUUID())||maid.getPersistentData().getBoolean(local.qdj.maids.brain.ResidentBodyAccess.DOWNED)))result.setReturnValue(false);
    }
}
