package local.qdj.maids.brain.mixin;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.item.ItemWirelessIO;
import com.github.tartaricacid.touhoulittlemaid.item.bauble.WirelessIOBauble;
import local.qdj.maids.brain.ResidentProtection;
import net.minecraft.world.item.ItemStack;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Recheck the actual bound container immediately before native IO, including membership revocation. */
@Mixin(value=WirelessIOBauble.class,remap=false)
public abstract class MaidResidentStorageMixin {
    @Inject(method="onTick",at=@At("HEAD"),cancellable=true,remap=false)
    private void residentContainer(EntityMaid maid,ItemStack stack,CallbackInfo ci){
        if(maid.tickCount%100!=0||maid.guiOpening)return;
        var target=ItemWirelessIO.getBindingPos(stack);
        if(target!=null&&!ResidentProtection.nativeAllowed(maid,"container",target))ci.cancel();
    }
}
