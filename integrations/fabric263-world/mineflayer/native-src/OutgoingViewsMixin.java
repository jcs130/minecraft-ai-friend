package dev.myagentworld.native263.mixin;

import dev.myagentworld.native263.NativeViews;
import dev.myagentworld.native263.NativeMenus;
import net.minecraft.network.protocol.Packet;
import net.minecraft.server.network.ServerCommonPacketListenerImpl;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ServerCommonPacketListenerImpl.class)
public abstract class OutgoingViewsMixin {
    @Inject(method = "send(Lnet/minecraft/network/protocol/Packet;)V", at = @At("HEAD"), require = 1)
    private void maw$translateOwnViews(Packet<?> packet, CallbackInfo ci) {
        NativeViews.beforeSend(this, packet);
        NativeMenus.beforeSend(this, packet);
    }
}
