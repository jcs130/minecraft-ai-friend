package local.hosting.mixin;

import local.hosting.NativePlayerCustody;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.common.ServerboundClientInformationPacket;
import net.minecraft.network.protocol.common.ServerboundCustomPayloadPacket;
import net.minecraft.network.protocol.common.ServerboundKeepAlivePacket;
import net.minecraft.network.protocol.common.ServerboundPongPacket;
import net.minecraft.network.protocol.game.ServerboundAcceptTeleportationPacket;
import net.minecraft.network.protocol.game.ServerboundChunkBatchReceivedPacket;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(value=ServerGamePacketListenerImpl.class,remap=false)
abstract class HostedPlayerPacketFenceMixin {
    @Shadow public ServerPlayer player;

    @Inject(method="shouldHandleMessage",at=@At("HEAD"),cancellable=true,require=1)
    private void qdj$fencePendingInput(Packet<?> packet,CallbackInfoReturnable<Boolean> result) {
        if (NativePlayerCustody.acceptsPlayerInput(player)) return;
        if (packet instanceof ServerboundKeepAlivePacket || packet instanceof ServerboundPongPacket
                || packet instanceof ServerboundAcceptTeleportationPacket || packet instanceof ServerboundChunkBatchReceivedPacket
                || packet instanceof ServerboundClientInformationPacket) return;
        if (packet instanceof ServerboundCustomPayloadPacket custom) {
            var channel=custom.payload().type().id().toString();
            if (channel.equals("qiandengji:handoff") || channel.equals("minecraft:brand")) return;
        }
        result.setReturnValue(false);
    }
}
