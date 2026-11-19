package local.qdj.maids.brain.mixin;

import com.github.tartaricacid.touhoulittlemaid.entity.ai.brain.task.MaidFollowOwnerTask;
import com.github.tartaricacid.touhoulittlemaid.entity.ai.brain.task.MaidFollowOwnerVehicleTask;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import local.qdj.maids.brain.MaidAgentsMod;
import net.minecraft.server.level.ServerLevel;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Only the travel destination changes while the controller has delegated expedition guard. */
@Mixin(value={MaidFollowOwnerTask.class, MaidFollowOwnerVehicleTask.class},remap=false)
public abstract class ResidentFollowOwnerMixin {
    @Inject(method="checkExtraStartConditions(Lnet/minecraft/server/level/ServerLevel;Lcom/github/tartaricacid/touhoulittlemaid/entity/passive/EntityMaid;)Z",
            at=@At("HEAD"),cancellable=true,remap=false)
    private void useExpeditionLeader(ServerLevel level, EntityMaid maid, CallbackInfoReturnable<Boolean> result) {
        if (MaidAgentsMod.hasExpeditionLeader(maid.getUUID())) result.setReturnValue(false);
    }
}
