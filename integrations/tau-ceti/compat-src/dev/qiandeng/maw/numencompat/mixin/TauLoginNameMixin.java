package dev.qiandeng.maw.numencompat.mixin;

import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.login.ServerboundHelloPacket;
import net.minecraft.server.network.ServerLoginPacketListenerImpl;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** An offline profile must not become a command selector in third-party warps.
 * Dot-prefixed Xbox names and ordinary Java/Agent identities remain unchanged. */
// MixAuth cancels handleHello at HEAD (default priority 1000). This guard must
// be merged before its callback; Mixin priorities are in natural/lower order.
@Mixin(value=ServerLoginPacketListenerImpl.class,priority=900,remap=false)
public abstract class TauLoginNameMixin {
    @Shadow public abstract void disconnect(Component reason);
    @Inject(method="handleHello",at=@At("HEAD"),cancellable=true,require=1)
    private void maw$rejectSelectorName(ServerboundHelloPacket packet,CallbackInfo callback) {
        if(packet.name().startsWith("@")) {
            disconnect(Component.literal("角色名不能以 @ 开头，请使用正常玩家名。"));
            callback.cancel();
        }
    }
}
