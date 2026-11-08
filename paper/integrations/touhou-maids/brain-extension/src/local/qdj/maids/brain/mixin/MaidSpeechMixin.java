package local.qdj.maids.brain.mixin;

import local.qdj.maids.brain.MaidSpeechControl;

import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.server.level.ServerPlayer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

// Before the vanilla resource-pack projection, so no client hears two voice identities.
@Mixin(targets="local.tlmcompat.nativebridge.NativePayloads",remap=false,priority=2100)
public abstract class MaidSpeechMixin {
    @Inject(method="send",at=@At("HEAD"),cancellable=true,remap=false)
    private static void companionVoice(ServerPlayer player,CustomPacketPayload payload,CallbackInfo callback){
        if(MaidSpeechControl.consume(player,payload))callback.cancel();
    }
}
